import { waitFor, delay, waitForResolved } from "@peerbit/time";
import crypto from "crypto";
import {
	waitForPeers as waitForPeerStreams,
	DirectStream,
	ConnectionManagerOptions,
	DirectStreamComponents
} from "..";
import {
	ACK,
	AcknowledgeDelivery,
	DataMessage,
	Message,
	MessageHeader,
	SeekDelivery,
	SilentDelivery,
	getMsgId
} from "@peerbit/stream-interface";
import { PublicSignKey } from "@peerbit/crypto";
import { PeerId } from "@libp2p/interface/peer-id";
import { Multiaddr } from "@multiformats/multiaddr";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { deserialize, serialize } from "@dao-xyz/borsh";
import { LibP2POptions, TestSession } from "@peerbit/libp2p-test-utils";

const collectDataWrites = (client: DirectStream) => {
	const writes: Map<string, DataMessage[]> = new Map();
	for (const [name, peer] of client.peers) {
		writes.set(name, []);
		const writeFn = peer.write.bind(peer);
		peer.write = (data) => {
			const bytes = data instanceof Uint8Array ? data : data.subarray();
			const message = deserialize(bytes, Message);
			if (message instanceof DataMessage) {
				writes.get(name)?.push(message);
			}
			return writeFn(data);
		};
	}
	return writes;
};

const getWritesCount = (writes: Map<string, DataMessage[]>) => {
	let sum = 0;
	for (const [k, v] of writes) {
		sum += v.length;
	}
	return sum;
};

const getUniqueMessages = async (messages: Message[]) => {
	const map: Map<string, Message> = new Map();
	for (const message of messages) {
		const id = await getMsgId(message.bytes());
		map.set(id, message);
	}
	return [...map.values()];
};

const createMetrics = (stream: DirectStream) => {
	const s: {
		stream: TestDirectStream;
		messages: Message[];
		received: DataMessage[];
		ack: ACK[];
		reachable: PublicSignKey[];
		unrechable: PublicSignKey[];
		processed: Map<string, number>;
	} = {
		messages: [],
		received: [],
		reachable: [],
		ack: [],
		unrechable: [],
		processed: new Map(),
		stream
	};
	s.stream.addEventListener("message", (msg) => {
		s.messages.push(msg.detail);
	});
	s.stream.addEventListener("data", (msg) => {
		s.received.push(msg.detail);
	});
	s.stream.addEventListener("peer:reachable", (msg) => {
		s.reachable.push(msg.detail);
	});
	s.stream.addEventListener("peer:unreachable", (msg) => {
		s.unrechable.push(msg.detail);
	});

	let processMessage = s.stream.processMessage.bind(s.stream);
	s.stream.processMessage = async (k, v, msg) => {
		const msgId = await getMsgId(
			msg instanceof Uint8Array ? msg : msg.subarray()
		);
		let prev = s.processed.get(msgId);
		s.processed.set(msgId, (prev ?? 0) + 1);
		return processMessage(k, v, msg);
	};

	const ackFn = s.stream.onAck.bind(s.stream);
	s.stream.onAck = (a, b, c) => {
		s.ack.push(c);
		return ackFn(a, b, c);
	};

	return s;
};
class TestDirectStream extends DirectStream {
	constructor(
		components: DirectStreamComponents,
		options: {
			id?: string;
			connectionManager?: ConnectionManagerOptions;
		} = {}
	) {
		super(components, [options.id || "test/0.0.0"], {
			canRelayMessage: true,
			emitSelf: true,
			connectionManager: options.connectionManager || {
				autoDial: false
			},
			...options
		});
	}
}
type TestSessionStream = TestSession<{ directstream: DirectStream }>;
const connected = async (
	n: number,
	options?:
		| LibP2POptions<{ directstream: TestDirectStream }>
		| LibP2POptions<{ directstream: TestDirectStream }>[]
) => {
	let session: TestSessionStream = await TestSession.connected(
		n,
		options || {
			services: {
				directstream: (components) => new TestDirectStream(components, options)
			}
		}
	);
	return session;
};

const disconnected = async (
	n: number,
	options?:
		| LibP2POptions<{ directstream: TestDirectStream }>
		| LibP2POptions<{ directstream: TestDirectStream }>[]
) => {
	let session: TestSessionStream = await TestSession.disconnected(
		n,
		options || {
			services: {
				directstream: (components) => new TestDirectStream(components, options)
			}
		}
	);
	return session;
};

const stream = (s: TestSessionStream, i: number): TestDirectStream =>
	service(s, i, "directstream") as TestDirectStream;
const service = (s: TestSessionStream, i: number, service: string) =>
	s.peers[i].services[service];
const waitForPeers = (s: TestSessionStream) =>
	waitForPeerStreams(...s.peers.map((x) => x.services.directstream));

describe("streams", function () {
	describe("publish", () => {
		const data = new Uint8Array([1, 2, 3]);

		describe("shortest path", () => {
			let session: TestSessionStream;
			let streams: ReturnType<typeof createMetrics>[];

			beforeAll(async () => {});

			beforeEach(async () => {
				// 0 and 2 not connected
				session = await disconnected(4, {
					services: {
						directstream: (c) =>
							new TestDirectStream(c, {
								connectionManager: { autoDial: false }
							})
					}
				});

				/* 
				┌─┐
				│0│
				└┬┘
				┌▽┐
				│1│
				└┬┘
				┌▽┐
				│2│
				└┬┘
				┌▽┐
				│3│
				└─┘
				*/

				streams = [];
				for (const peer of session.peers) {
					streams.push(createMetrics(peer.services.directstream));
				}
				await session.connect([
					// behaviour seems to be more predictable if we connect after start (TODO improve startup to use existing connections in a better way)
					[session.peers[0], session.peers[1]],
					[session.peers[1], session.peers[2]],
					[session.peers[2], session.peers[3]]
				]);

				await waitForPeerStreams(streams[0].stream, streams[1].stream);
				await waitForPeerStreams(streams[1].stream, streams[2].stream);
				await waitForPeerStreams(streams[2].stream, streams[3].stream);
			});

			afterEach(async () => {
				await session.stop();
			});

			it("1->unknown", async () => {
				await streams[0].stream.publish(data);
				await waitFor(() => streams[1].received.length === 1);
				expect(new Uint8Array(streams[1].received[0].data!)).toEqual(data);
				await waitFor(() => streams[2].received.length === 1);
				expect(new Uint8Array(streams[2].received[0].data!)).toEqual(data);
				await delay(1000); // wait some more time to make sure we dont get more messages
				expect(streams[1].received).toHaveLength(1);
				expect(streams[2].received).toHaveLength(1);
				expect(streams[3].received).toHaveLength(1);

				for (const [i, stream] of streams.entries()) {
					if (i < 2) {
						// because i = 2 is the last node and that node has no-where else to look
						expect(stream.stream.pending).toBeTrue(); // beacuse seeking with explitictly defined end (will timeout eventuallyl)
					}
				}

				// expect routes to have be defined
				await waitForResolved(() =>
					expect(streams[0].stream.routes.count()).toEqual(3)
				);
			});

			it("1->2", async () => {
				await streams[0].stream.publish(data, {
					to: [streams[1].stream.components.peerId]
				});

				await waitFor(() => streams[1].received.length === 1);

				for (const stream of streams) {
					expect(stream.stream.pending).toBeFalse(); // since receiver is known and SilentDeliery by default if providing to: [...]
				}

				let receivedMessage = streams[1].received[0];
				expect(new Uint8Array(receivedMessage.data!)).toEqual(data);
				await delay(1000); // wait some more time to make sure we dont get more messages
				expect(streams[1].received).toHaveLength(1);
				expect(streams[2].received).toHaveLength(0);

				// Never seen a message twice
				expect(
					[...streams[0].processed.values()].find((x) => x > 1)
				).toBeUndefined();
				expect(
					[...streams[1].processed.values()].find((x) => x > 1)
				).toBeUndefined();
				expect(
					[...streams[2].processed.values()].find((x) => x > 1)
				).toBeUndefined();
			});

			it("1->3", async () => {
				await streams[0].stream.publish(data, {
					to: [streams[2].stream.components.peerId]
				});

				await waitForResolved(() =>
					expect(streams[2].received).toHaveLength(1)
				);
				expect(new Uint8Array(streams[2].received[0].data!)).toEqual(data);
				await delay(1000); // wait some more time to make sure we dont get more messages
				expect(streams[2].received).toHaveLength(1);
				expect(streams[1].received).toHaveLength(0);
			});

			it("1->3 10mb data", async () => {
				const bigData = crypto.randomBytes(1e7);
				await streams[0].stream.publish(bigData, {
					to: [streams[2].stream.components.peerId]
				});

				await waitForResolved(() =>
					expect(streams[2].received).toHaveLength(1)
				);

				expect(new Uint8Array(streams[2].received[0].data!)).toHaveLength(
					bigData.length
				);
				expect(streams[2].received).toHaveLength(1);
				expect(streams[1].received).toHaveLength(0);
			});

			it("1->3 still works even if routing is missing", async () => {
				streams[0].stream.routes.clear();
				streams[1].stream.routes.clear();
				await streams[0].stream.publish(data, {
					to: [streams[2].stream.components.peerId]
				});
				await waitForResolved(() =>
					expect(streams[2].received).toHaveLength(1)
				);
				expect(new Uint8Array(streams[2].received[0].data!)).toEqual(data);
				await delay(1000); // wait some more time to make sure we dont get more messages
				expect(streams[2].received).toHaveLength(1);
				expect(streams[1].received).toHaveLength(0);
			});

			it("publishes on direct stream, even path is longer", async () => {
				await session.connect([[session.peers[0], session.peers[2]]]);
				await waitForPeerStreams(streams[0].stream, streams[2].stream);

				// mark 0 -> 1 -> 2 as shortest route...

				streams[0].stream.routes.add(
					streams[0].stream.publicKeyHash,
					streams[1].stream.publicKeyHash,
					streams[2].stream.publicKeyHash,
					0
				);

				await streams[0].stream.publish(crypto.randomBytes(1e2), {
					to: [streams[2].stream.components.peerId]
				});
				streams[1].messages = [];
				await waitForResolved(() =>
					expect(streams[2].received).toHaveLength(1)
				);

				// ...yet make sure the data has not travelled this path
				expect(
					streams[1].messages.filter((x) => x instanceof DataMessage)
				).toHaveLength(0);
			});

			it("will favor shortest path", async () => {
				/* 
				┌───┐
				│0  │
				└┬─┬┘
				 │┌▽┐
				 ││1│
				 │└┬┘
				┌▽─▽┐
				│2  │
				└┬──┘
				┌▽┐  
				│3│  
				└─┘   
				*/

				await session.connect([[session.peers[0], session.peers[2]]]);
				await waitForPeerStreams(streams[0].stream, streams[2].stream);

				streams[0].stream.routes.add(
					streams[0].stream.publicKeyHash,
					streams[1].stream.publicKeyHash,
					streams[3].stream.publicKeyHash,
					0
				);

				await streams[0].stream.publish(crypto.randomBytes(1e2), {
					to: [streams[3].stream.components.peerId]
				});

				streams[1].messages = [];

				// will send through peer [1] since path [0] -> [2] -> [3] directly is currently longer
				await waitForResolved(() =>
					expect(
						streams[1].messages.filter((x) => x instanceof DataMessage)
					).toHaveLength(1)
				);

				await waitForResolved(() =>
					expect(streams[3].received).toHaveLength(1)
				);

				streams[1].messages = [];

				streams[0].stream.routes.add(
					streams[0].stream.publicKeyHash,
					streams[2].stream.publicKeyHash,
					streams[3].stream.publicKeyHash,
					0
				);
				await streams[0].stream.publish(crypto.randomBytes(1e2), {
					to: [streams[3].stream.components.peerId]
				});
				await waitFor(() => streams[3].received.length === 1);
				const messages = streams[1].messages.filter(
					(x) => x instanceof DataMessage
				);

				// no new messages for peer 1, because sending 0 -> 2 -> 3 directly is now faster
				expect(messages).toHaveLength(0);
				expect(streams[1].received).toHaveLength(0);
			});

			it("will eventually figure out shortest path", async () => {
				/* 
				┌───┐
				│ 0 │
				└┬─┬┘
				 │┌▽┐
				 ││1│
				 │└┬┘
				┌▽─▽┐
				│2  │
				└┬──┘
				┌▽┐  
				│3│  
				└─┘   
				*/

				await session.connect([[session.peers[0], session.peers[2]]]);
				await waitForPeerStreams(streams[0].stream, streams[2].stream);

				await streams[0].stream.publish(crypto.randomBytes(1e2), {
					to: [streams[3].stream.components.peerId]
				});

				// because node 2 will deduplicate message coming from 1, only 1 data message will arrive to node 3
				// hence only one ACK will be returned to A
				await waitForResolved(() => expect(streams[0].ack).toHaveLength(1));
				await delay(2000);
				await waitForResolved(() => expect(streams[0].ack).toHaveLength(1));

				streams[1].messages = [];
				streams[3].received = [];

				expect(
					streams[0].stream.routes
						.findNeighbor(
							streams[0].stream.publicKeyHash,
							streams[3].stream.publicKeyHash
						)
						?.list?.map((x) => x.hash)
				).toEqual([streams[2].stream.publicKeyHash]); // "2" is fastest route
				await streams[0].stream.publish(crypto.randomBytes(1e2), {
					to: [streams[3].stream.components.peerId]
				});

				await waitFor(() => streams[3].received.length === 1);

				expect(streams[1].messages).toHaveLength(0); // Because shortest route is 0 -> 2 -> 3
				expect(streams[1].stream.routes.count()).toEqual(2);
			});
		});

		describe("fanout", () => {
			describe("basic", () => {
				let session: TestSessionStream;
				let streams: ReturnType<typeof createMetrics>[];

				beforeAll(async () => {});

				beforeEach(async () => {
					session = await connected(3, {
						services: {
							directstream: (c) =>
								new TestDirectStream(c, {
									connectionManager: { autoDial: false }
								})
						}
					});
					streams = [];
					for (const peer of session.peers) {
						streams.push(createMetrics(peer.services.directstream));
					}

					await waitForPeerStreams(streams[0].stream, streams[1].stream);
				});

				afterEach(async () => {
					await session.stop();
				});

				it("will not publish to 'from' when explicitly providing to", async () => {
					const msg = new DataMessage({
						data: new Uint8Array([0]),
						deliveryMode: new SeekDelivery(1)
					});
					streams[2].stream.canRelayMessage = false; // so that 2 does not relay to 0

					await streams[1].stream.publishMessage(
						session.peers[0].services.directstream.publicKey,
						await msg.sign(streams[1].stream.sign),
						[
							//streams[1].stream.peers.get(streams[0].stream.publicKeyHash)!,
							streams[1].stream.peers.get(streams[2].stream.publicKeyHash)!
						]
					);
					const msgId = await getMsgId(msg.bytes());
					await waitForResolved(() =>
						expect(streams[2].processed.get(msgId)).toEqual(1)
					);

					await delay(1000); // wait for more messages eventually propagate
					expect(streams[0].processed.get(msgId)).toBeUndefined();
					expect(streams[1].processed.get(msgId)).toBeUndefined();
				});

				/**
				 * If tests below fails, dead-locks can apphear in unpredictable ways
				 */
				it("to in message will not send back", async () => {
					const msg = new DataMessage({
						data: new Uint8Array([0]),
						header: new MessageHeader({
							to: [
								streams[0].stream.publicKeyHash,
								streams[2].stream.publicKeyHash
							]
						}),
						deliveryMode: new SeekDelivery(1)
					});
					streams[2].stream.canRelayMessage = false; // so that 2 does not relay to 0

					await msg.sign(streams[1].stream.sign);
					await streams[1].stream.publishMessage(
						session.peers[0].services.directstream.publicKey,
						msg,
						undefined,
						true
					);
					await delay(1000);
					const msgId = await getMsgId(msg.bytes());
					expect(streams[0].processed.get(msgId)).toBeUndefined();
					expect(streams[1].processed.get(msgId)).toBeUndefined();
					expect(streams[2].processed.get(msgId)).toEqual(1);
				});

				it("rejects when to peers is from", async () => {
					const msg = new DataMessage({
						data: new Uint8Array([0]),
						deliveryMode: new SilentDelivery(1)
					});
					await msg.sign(streams[1].stream.sign);
					await expect(
						streams[1].stream.publishMessage(
							session.peers[0].services.directstream.publicKey,
							msg,
							[streams[1].stream.peers.get(streams[0].stream.publicKeyHash)!]
						)
					).rejects.toThrowError("Message did not have any valid receivers");
				});

				it("rejects when only to is from", async () => {
					const msg = new DataMessage({
						data: new Uint8Array([0]),
						header: new MessageHeader({
							to: [streams[0].stream.publicKeyHash]
						}),
						deliveryMode: new SilentDelivery(1)
					});
					await msg.sign(streams[1].stream.sign);
					await streams[1].stream.publishMessage(
						session.peers[0].services.directstream.publicKey,
						msg
					);
					const msgId = await getMsgId(msg.bytes());
					await delay(1000);
					expect(streams[0].processed.get(msgId)).toBeUndefined();
					expect(streams[1].processed.get(msgId)).toBeUndefined();
					expect(streams[2].processed.get(msgId)).toBeUndefined();
				});

				it("will send through peer", async () => {
					await session.peers[0].hangUp(session.peers[1].peerId);

					// send a message with to=[2]
					// make sure message is received
					const msg = new DataMessage({
						data: new Uint8Array([0]),
						header: new MessageHeader({
							to: [streams[2].stream.publicKeyHash]
						}),
						deliveryMode: new SeekDelivery(1)
					});
					await msg.sign(streams[1].stream.sign);
					await streams[0].stream.publishMessage(
						session.peers[0].services.directstream.publicKey,
						msg
					);
					await waitForResolved(() =>
						expect(streams[2].received).toHaveLength(1)
					);
				});
			});

			describe("1->2", () => {
				let session: TestSessionStream;
				let streams: ReturnType<typeof createMetrics>[];
				const data = new Uint8Array([1, 2, 3]);

				beforeAll(async () => {});

				beforeEach(async () => {
					session = await connected(3, {
						services: {
							directstream: (c) =>
								new TestDirectStream(c, {
									connectionManager: { autoDial: false }
								})
						}
					});
					streams = [];
					for (const peer of session.peers) {
						await waitForResolved(() =>
							expect(peer.services.directstream.peers.size).toEqual(
								session.peers.length - 1
							)
						);
						streams.push(createMetrics(peer.services.directstream));
					}
				});

				afterEach(async () => {
					await session.stop();
				});

				it("messages are only sent once to each peer", async () => {
					let totalWrites = 1;
					expect(streams[0].ack).toHaveLength(0);

					//  push one message to ensure paths are found
					await streams[0].stream.publish(data, {
						to: [
							streams[1].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						],
						mode: new SeekDelivery(1)
					});

					// message delivered to 1 from 0 and relayed through 2. (2 ACKS)
					// message delivered to 2 from 0 and relayed through 1. (2 ACKS)
					// 2 + 2 = 4
					expect(
						streams[0].stream.routes.isReachable(
							streams[0].stream.publicKeyHash,
							streams[1].stream.publicKeyHash
						)
					).toBeTrue();
					expect(
						streams[0].stream.routes.isReachable(
							streams[0].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
					).toBeTrue();

					await waitForResolved(async () =>
						expect(streams[0].ack).toHaveLength(4)
					);

					const allWrites = streams.map((x) => collectDataWrites(x.stream));
					streams[1].received = [];
					streams[2].received = [];

					// expect the data to be sent smartly
					for (let i = 0; i < totalWrites; i++) {
						await streams[0].stream.publish(data, {
							to: [
								streams[1].stream.publicKeyHash,
								streams[2].stream.publicKeyHash
							]
						});
					}

					await waitForResolved(() =>
						expect(streams[1].received).toHaveLength(totalWrites)
					);
					await waitForResolved(() =>
						expect(streams[2].received).toHaveLength(totalWrites)
					);

					await delay(2000);

					// Check number of writes for each node
					expect(getWritesCount(allWrites[0])).toEqual(totalWrites * 2); // write to "1" or "2"
					expect(getWritesCount(allWrites[1])).toEqual(0); // "1" should never has to push any data
					expect(getWritesCount(allWrites[2])).toEqual(0); // "2" should never has to push any data
				});
			});

			describe("1->2->2", () => {
				/** 
			┌─────┐ 
			│0    │ 
			└┬───┬┘ 
			┌▽─┐┌▽─┐
			│2 ││1 │
			└┬┬┘└┬┬┘
			 ││  ││ 
			 ││  ││ 
			 ││  └│┐
			 └│──┐││
			 ┌│──│┘│
			 ││  │┌┘
			┌▽▽┐┌▽▽┐
			│3 ││4 │ // 3 and 4 are connected also
			└──┘└──┘
			*/

				let session: TestSessionStream;
				let streams: ReturnType<typeof createMetrics>[];
				const data = new Uint8Array([1, 2, 3]);

				beforeAll(async () => {});

				beforeEach(async () => {
					session = await disconnected(5, {
						services: {
							directstream: (c) =>
								new TestDirectStream(c, {
									connectionManager: { autoDial: false }
								})
						}
					});
					streams = [];
					for (const peer of session.peers) {
						streams.push(createMetrics(peer.services.directstream));
					}
					await session.connect([
						// behaviour seems to be more predictable if we connect after start (TODO improve startup to use existing connections in a better way)
						[session.peers[0], session.peers[1]],
						[session.peers[0], session.peers[2]],

						[session.peers[1], session.peers[3]],
						[session.peers[1], session.peers[4]],

						[session.peers[2], session.peers[3]],
						[session.peers[2], session.peers[4]],

						[session.peers[3], session.peers[4]]
					]);

					await waitForPeerStreams(streams[0].stream, streams[1].stream);
					await waitForPeerStreams(streams[0].stream, streams[2].stream);
					await waitForPeerStreams(streams[1].stream, streams[3].stream);
					await waitForPeerStreams(streams[1].stream, streams[4].stream);
					await waitForPeerStreams(streams[2].stream, streams[3].stream);
					await waitForPeerStreams(streams[2].stream, streams[4].stream);
					await waitForPeerStreams(streams[3].stream, streams[4].stream);
				});

				afterEach(async () => {
					await session.stop();
				});

				it("messages are only sent once to each peer", async () => {
					await streams[0].stream.publish(data, {
						to: [
							streams[3].stream.publicKeyHash,
							streams[4].stream.publicKeyHash
						],
						mode: new SeekDelivery(2)
					});

					expect(
						streams[0].stream.routes.isReachable(
							streams[0].stream.publicKeyHash,
							streams[3].stream.publicKeyHash
						)
					).toBeTrue();
					expect(
						streams[0].stream.routes.isReachable(
							streams[0].stream.publicKeyHash,
							streams[4].stream.publicKeyHash
						)
					).toBeTrue();

					expect(
						streams[0].stream.routes.findNeighbor(
							streams[0].stream.publicKeyHash,
							streams[3].stream.publicKeyHash
						)?.list
					).toHaveLength(2);

					expect(
						streams[0].stream.routes.findNeighbor(
							streams[0].stream.publicKeyHash,
							streams[4].stream.publicKeyHash
						)?.list
					).toHaveLength(2);

					const allWrites = streams.map((x) => collectDataWrites(x.stream));

					let totalWrites = 100;
					streams[3].received = [];
					streams[4].received = [];
					streams[3].processed.clear();
					streams[4].processed.clear();

					for (let i = 0; i < totalWrites; i++) {
						streams[0].stream.publish(data, {
							to: [
								streams[3].stream.publicKeyHash,
								streams[4].stream.publicKeyHash
							]
						});
					}

					await waitForResolved(() =>
						expect(streams[3].received).toHaveLength(totalWrites)
					);
					await waitForResolved(() =>
						expect(streams[4].received).toHaveLength(totalWrites)
					);

					const id1 = await getMsgId(serialize(streams[3].received[0]));

					await delay(3000); // Wait some exstra time if additional messages are propagating through

					expect(streams[3].processed.get(id1)).toEqual(1); // 1 delivery even though there are multiple path leading to this node
					expect(streams[4].processed.get(id1)).toEqual(1); // 1 delivery even though there are multiple path leading to this node

					// Check number of writes for each node
					expect(getWritesCount(allWrites[0])).toEqual(totalWrites); // write to "1" or "2"
					expect(
						getWritesCount(allWrites[1]) + getWritesCount(allWrites[2])
					).toEqual(totalWrites * 2); // write to "3" and "4"
					expect(getWritesCount(allWrites[3])).toEqual(0); // "3" should never has to push any data
					expect(getWritesCount(allWrites[4])).toEqual(0); // "4" should never has to push any data
				});

				it("can send with higher redundancy", async () => {
					await streams[0].stream.publish(data, {
						to: [
							streams[3].stream.publicKeyHash,
							streams[4].stream.publicKeyHash
						],
						mode: new SeekDelivery(2)
					});

					const neighbourTo3 = streams[0].stream.routes.findNeighbor(
						streams[0].stream.publicKeyHash,
						streams[3].stream.publicKeyHash
					)!.list[0];

					expect(
						streams[0].stream.routes.isReachable(
							streams[0].stream.publicKeyHash,
							streams[3].stream.publicKeyHash
						)
					).toBeTrue();
					expect(
						streams[0].stream.routes.isReachable(
							streams[0].stream.publicKeyHash,
							streams[4].stream.publicKeyHash
						)
					).toBeTrue();

					streams.find(
						(x) => x.stream.publicKeyHash === neighbourTo3.hash
					)!.stream.processMessage = async (a, b, c) => {
						// dont do anything
					};

					await streams[0].stream.publish(data, {
						to: [
							streams[3].stream.publicKeyHash,
							streams[4].stream.publicKeyHash
						],
						mode: new AcknowledgeDelivery(2) // send at least 2 routes
					});
				});
			});
		});
	});

	// TODO test that messages are not sent backward, triangles etc

	describe("join/leave", () => {
		let session: TestSessionStream;
		let streams: ReturnType<typeof createMetrics>[];
		const data = new Uint8Array([1, 2, 3]);
		let autoDialRetryDelay = 5 * 1000;

		describe("direct connections", () => {
			beforeEach(async () => {
				session = await disconnected(
					4,
					new Array(4).fill(0).map((_x, i) => {
						return {
							services: {
								directstream: (c) =>
									new TestDirectStream(c, {
										connectionManager: {
											autoDial: i === 0, // allow client 0 to auto dial
											retryDelay: autoDialRetryDelay
										}
									})
							}
						};
					})
				); // Second arg is due to https://github.com/transport/js-libp2p/issues/1690
				streams = [];

				for (const [i, peer] of session.peers.entries()) {
					if (i === 0) {
						expect(
							peer.services.directstream["connectionManagerOptions"].autoDial
						).toBeTrue();
					} else {
						expect(
							peer.services.directstream["connectionManagerOptions"].autoDial
						).toBeFalse();
					}

					streams.push(createMetrics(peer.services.directstream));
				}

				// slowly connect to that the route maps are deterministic
				await session.connect([[session.peers[0], session.peers[1]]]);
				await session.connect([[session.peers[1], session.peers[2]]]);
				await session.connect([[session.peers[2], session.peers[3]]]);
				await waitForPeerStreams(streams[0].stream, streams[1].stream);
				await waitForPeerStreams(streams[1].stream, streams[2].stream);
				await waitForPeerStreams(streams[2].stream, streams[3].stream);
			});

			afterEach(async () => {
				await session.stop();
			});

			it("directly if possible", async () => {
				let dials = 0;
				const dialFn =
					streams[0].stream.components.connectionManager.openConnection.bind(
						streams[0].stream.components.connectionManager
					);
				streams[0].stream.components.connectionManager.openConnection = (
					a,
					b
				) => {
					dials += 1;
					return dialFn(a, b);
				};

				streams[3].received = [];
				expect(streams[0].stream.peers.size).toEqual(1);

				await streams[0].stream.publish(data, {
					to: [streams[3].stream.components.peerId],
					mode: new SeekDelivery(1)
				});

				await waitFor(() => streams[0].ack.length === 1);

				// Dialing will yield a new connection
				await waitForResolved(() =>
					expect(streams[0].stream.peers.size).toEqual(2)
				);

				expect(dials).toEqual(1);

				// Republishing will not result in an additional dial
				await streams[0].stream.publish(data, {
					to: [streams[3].stream.components.peerId]
				});
				await waitFor(() => streams[3].received.length === 2);
				expect(dials).toEqual(1);
				expect(streams[0].stream.peers.size).toEqual(2);
				expect(
					streams[0].stream.peers.has(streams[3].stream.publicKeyHash)
				).toBeTrue();
				expect(
					streams[0].stream.peers.has(streams[1].stream.publicKeyHash)
				).toBeTrue();
			});

			it("retry dial after a while", async () => {
				let dials: (PeerId | Multiaddr | Multiaddr[])[] = [];
				streams[0].stream.components.connectionManager.openConnection = (
					a,
					b
				) => {
					dials.push(a);
					throw new Error("Mock Error");
				};

				streams[3].received = [];
				expect(streams[0].stream.peers.size).toEqual(1);

				await streams[0].stream.publish(data, {
					to: [streams[3].stream.components.peerId],
					mode: new SeekDelivery(1)
				});

				await waitForResolved(() => expect(streams[0].ack).toHaveLength(1));

				// Dialing will yield a new connection
				await waitFor(() => streams[0].stream.peers.size === 1);
				let expectedDialsCount = 1; // 1 dial directly
				expect(dials).toHaveLength(expectedDialsCount);

				// Republishing will not result in an additional dial
				await streams[0].stream.publish(data, {
					to: [streams[3].stream.components.peerId],
					mode: new SeekDelivery(1)
				});

				await waitForResolved(() => expect(streams[0].ack).toHaveLength(2));

				let t1 = +new Date();
				expect(dials).toHaveLength(expectedDialsCount); // No change, because TTL > autoDialRetryTimeout
				await waitFor(() => +new Date() - t1 > autoDialRetryDelay);

				// Try again, now expect another dial call, since the retry interval has been reached
				await streams[0].stream.publish(data, {
					to: [streams[3].stream.components.peerId],
					mode: new SeekDelivery(1)
				});
				await waitForResolved(() => expect(streams[0].ack).toHaveLength(3));

				expect(dials).toHaveLength(2);
			});

			/* TODO test that autodialler tries multiple addresses 
			
			it("through relay if fails", async () => {
				const dialFn =
					streams[0].stream.components.connectionManager.openConnection.bind(
						streams[0].stream.components.connectionManager
					);

				let directlyDialded = false;
				const filteredDial = (address: PeerId | Multiaddr | Multiaddr[]) => {
					if (
						isPeerId(address) &&
						address.toString() === streams[3].stream.peerIdStr
					) {
						throw new Error("Mock fail"); // don't allow connect directly
					}

					let addresses: Multiaddr[] = Array.isArray(address)
						? address
						: [address as Multiaddr];
					for (const a of addresses) {
						if (
							!a.protoNames().includes("p2p-circuit") &&
							a.toString().includes(streams[3].stream.peerIdStr)
						) {
							throw new Error("Mock fail"); // don't allow connect directly
						}
					}
					addresses = addresses.map((x) =>
						x.protoNames().includes("p2p-circuit")
							? multiaddr(x.toString().replace("/webrtc/", "/"))
							: x
					); // TODO use webrtc in node

					directlyDialded = true;
					return dialFn(addresses);
				};

				streams[0].stream.components.connectionManager.openConnection =
					filteredDial;
				expect(streams[0].stream.peers.size).toEqual(1);
				await streams[0].stream.publish(data, {
					to: [streams[3].stream.components.peerId],
					mode: new SeekDelivery(1)
				});
				await waitFor(() => streams[3].received.length === 1);
				await waitForResolved(() => expect(directlyDialded).toBeTrue());
			}); */
		});

		describe("4", () => {
			beforeEach(async () => {
				session = await disconnected(4, {
					services: {
						directstream: (c) =>
							new TestDirectStream(c, {
								connectionManager: { autoDial: false }
							})
					}
				});

				/* 
				┌─┐
				│3│
				└┬┘
				┌▽┐
				│0│
				└┬┘
				┌▽┐
				│1│
				└┬┘
				┌▽┐
				│2│
				└─┘
				
				 */

				streams = [];
				for (const peer of session.peers) {
					streams.push(createMetrics(peer.services.directstream));
				}

				// slowly connect to that the route maps are deterministic
				await session.connect([[session.peers[0], session.peers[1]]]);
				await session.connect([[session.peers[1], session.peers[2]]]);
				await session.connect([[session.peers[0], session.peers[3]]]);
				await waitForPeerStreams(streams[0].stream, streams[1].stream);
				await waitForPeerStreams(streams[1].stream, streams[2].stream);
				await waitForPeerStreams(streams[0].stream, streams[3].stream);

				expect([...streams[0].stream.peers.keys()]).toEqual([
					streams[1].stream.publicKeyHash,
					streams[3].stream.publicKeyHash
				]);
				expect([...streams[1].stream.peers.keys()]).toEqual([
					streams[0].stream.publicKeyHash,
					streams[2].stream.publicKeyHash
				]);
				expect([...streams[2].stream.peers.keys()]).toEqual([
					streams[1].stream.publicKeyHash
				]);
				expect([...streams[3].stream.peers.keys()]).toEqual([
					streams[0].stream.publicKeyHash
				]); // peer has recevied reachable event from everone
			});

			afterEach(async () => {
				await session.stop();
			});

			it("re-route new connection", async () => {
				/* 					
				┌───┐ 
				│3  │ 
				└┬─┬┘ 
				│┌▽┐ 
				││0│ 
				│└┬┘ 
				│┌▽─┐
				││1 │
				│└┬─┘
				┌▽─▽┐ 
				│2  │ 
				└───┘ 
				 */

				await streams[3].stream.publish(new Uint8Array(0), {
					to: [streams[2].stream.publicKeyHash],
					mode: new SeekDelivery(2)
				});
				expect(
					streams[3].stream.routes
						.findNeighbor(
							streams[3].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
						?.list?.map((x) => x.hash)
				).toEqual([streams[0].stream.publicKeyHash]);
				await session.connect([[session.peers[2], session.peers[3]]]);
				await waitForPeerStreams(streams[2].stream, streams[3].stream);
				await streams[3].stream.publish(new Uint8Array(0), {
					to: [streams[2].stream.publicKeyHash],
					mode: new SeekDelivery(2)
				});
				await waitForResolved(() => {
					expect(
						streams[3].stream.routes
							.findNeighbor(
								streams[3].stream.publicKeyHash,
								streams[2].stream.publicKeyHash
							)
							?.list.map((x) => x.hash)
					).toEqual([
						streams[2].stream.publicKeyHash,
						streams[0].stream.publicKeyHash
					]);
				});
			});

			it("neighbour drop", async () => {
				await streams[3].stream.publish(new Uint8Array(0), {
					to: [streams[2].stream.publicKeyHash],
					mode: new SeekDelivery(2)
				});
				expect(
					streams[3].stream.routes
						.findNeighbor(
							streams[3].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
						?.list?.map((x) => x.hash)
				).toEqual([streams[0].stream.publicKeyHash]);
				await session.peers[0].stop();
				await waitForResolved(() => {
					expect(
						streams[3].stream.routes.findNeighbor(
							streams[3].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
					).toBeUndefined();
				});
			});

			it("distant drop", async () => {
				await streams[3].stream.publish(new Uint8Array(0), {
					to: [streams[2].stream.publicKeyHash],
					mode: new SeekDelivery(2)
				});
				expect(
					streams[3].stream.routes
						.findNeighbor(
							streams[3].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
						?.list?.map((x) => x.hash)
				).toEqual([streams[0].stream.publicKeyHash]);
				await session.peers[2].stop();
				await waitForResolved(() => {
					expect(
						streams[3].stream.routes.isReachable(
							streams[3].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
					).toEqual(false);
				});

				await waitForResolved(() => {
					expect(
						streams[3].stream.routes.findNeighbor(
							streams[3].stream.publicKeyHash,
							streams[2].stream.publicKeyHash
						)
					).toBeUndefined();
				});
			});
		});

		describe("invalidation", () => {
			let extraSession: TestSessionStream;
			beforeEach(async () => {
				session = await connected(3);

				for (let i = 0; i < session.peers.length; i++) {
					await waitForResolved(() =>
						expect(
							session.peers[i].services.directstream.routes.count()
						).toEqual(2)
					);
				}
			});
			afterEach(async () => {
				await session?.stop();
				await extraSession?.stop();
			});

			it("will not get blocked for slow writes", async () => {
				let slowPeer = [1, 2];
				let fastPeer = [2, 1];
				let directDelivery = [true, false];
				for (let i = 0; i < slowPeer.length; i++) {
					const slow = session.peers[0].services.directstream.peers.get(
						session.peers[slowPeer[i]].services.directstream.publicKeyHash
					)!;
					const fast = session.peers[0].services.directstream.peers.get(
						session.peers[fastPeer[i]].services.directstream.publicKeyHash
					)!;

					expect(slow).toBeDefined();
					const waitForWriteDefaultFn = slow.waitForWrite.bind(slow);
					slow.waitForWrite = async (bytes) => {
						await delay(3000);
						return waitForWriteDefaultFn(bytes);
					};

					const t0 = +new Date();
					let t1: number | undefined = undefined;
					await session.peers[0].services.directstream.publish(
						new Uint8Array([1, 2, 3]),
						{
							to: directDelivery[i] ? [slow.publicKey, fast.publicKey] : [] // undefined ?
						}
					);

					let listener = () => {
						t1 = +new Date();
					};
					session.peers[fastPeer[i]].services.directstream.addEventListener(
						"data",
						listener
					);
					await waitForResolved(() => expect(t1).toBeDefined());

					expect(t1! - t0).toBeLessThan(3000);

					// reset
					slow.waitForWrite = waitForWriteDefaultFn;
					session.peers[fastPeer[i]].services.directstream.removeEventListener(
						"data",
						listener
					);
				}
			});
		});
	});

	describe("start/stop", () => {
		let session: TestSessionStream;

		afterEach(async () => {
			await session.stop();
		});

		it("can restart", async () => {
			session = await connected(2, {
				transports: [tcp(), webSockets({ filter: filters.all })],
				services: {
					directstream: (c) =>
						new TestDirectStream(c, {
							connectionManager: { autoDial: false }
						})
				}
			}); // use 2 transports as this might cause issues if code is not handling multiple connections correctly
			await waitForPeerStreams(stream(session, 0), stream(session, 1));

			/* await waitFor(() => stream(session, 1).helloMap.size == 1); */
			await stream(session, 0).stop();
			/* await waitFor(() => stream(session, 1).helloMap.size === 0); */

			await stream(session, 1).stop();
			expect(stream(session, 0).peers.size).toEqual(0);
			await delay(3000);
			await stream(session, 0).start();
			/* expect(stream(session, 0).helloMap.size).toEqual(0); */
			await stream(session, 1).start();

			await waitFor(() => stream(session, 0).peers.size === 1);
			/* 	await waitFor(() => stream(session, 0).helloMap.size === 1);
				await waitFor(() => stream(session, 1).helloMap.size === 1); */
			await waitForPeerStreams(stream(session, 0), stream(session, 1));
		});
		it("can connect after start", async () => {
			session = await disconnected(2, {
				transports: [tcp(), webSockets({ filter: filters.all })],
				services: {
					directstream: (c) => new TestDirectStream(c)
				}
			});

			await session.connect();
			await waitForPeerStreams(stream(session, 0), stream(session, 1));
		});

		it("can connect before start", async () => {
			session = await connected(2, {
				transports: [tcp(), webSockets({ filter: filters.all })],
				services: {
					directstream: (c) => new TestDirectStream(c)
				}
			});
			await delay(3000);

			await stream(session, 0).start();
			await stream(session, 1).start();

			await waitForPeerStreams(stream(session, 0), stream(session, 1));
		});

		it("can connect with delay", async () => {
			session = await connected(2, {
				transports: [tcp(), webSockets({ filter: filters.all })],
				services: {
					directstream: (c) => new TestDirectStream(c)
				}
			});
			await waitForPeerStreams(stream(session, 0), stream(session, 1));
			await session.peers[0].services.directstream.stop();
			await session.peers[1].services.directstream.stop();
			await waitFor(
				() => session.peers[0].services.directstream.peers.size === 0
			);
			await waitFor(
				() => session.peers[1].services.directstream.peers.size === 0
			);
			await session.peers[1].services.directstream.start();
			await delay(3000);
			await session.peers[0].services.directstream.start();
			await waitForPeerStreams(stream(session, 0), stream(session, 1));
		});
	});

	describe("multistream", () => {
		let session: TestSessionStream;
		beforeEach(async () => {
			session = await TestSession.connected(2, {
				transports: [tcp(), webSockets({ filter: filters.all })],
				services: {
					directstream: (c) => new TestDirectStream(c),
					directstream2: (c) =>
						new TestDirectStream(c, { id: "another-protocol" })
				}
			}); // use 2 transports as this might cause issues if code is not handling multiple connections correctly
		});

		afterEach(async () => {
			await session.stop();
		});

		it("can setup multiple streams at once", async () => {
			await waitFor(() => !!stream(session, 0).peers.size);
			await waitFor(() => !!stream(session, 1).peers.size);
			await waitFor(() => !!service(session, 0, "directstream2").peers.size);
			await waitFor(() => !!service(session, 1, "directstream2").peers.size);
		});
	});
});
