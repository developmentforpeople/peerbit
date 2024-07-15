import { delay, waitFor, waitForResolved } from "@peerbit/time";
import { EventStore } from "./utils/stores/event-store.js";
import { TestSession } from "@peerbit/test-utils";
import { deserialize } from "@dao-xyz/borsh";
import { Ed25519Keypair } from "@peerbit/crypto";
import { isMatured } from "../src/ranges.js";
import { expect } from 'chai'
import { SearchRequest } from "@peerbit/indexer-interface";

describe(`role`, () => {
	let session: TestSession;
	let db1: EventStore<string>, db2: EventStore<string>;

	before(async () => {
		session = await TestSession.disconnected(3, [
			{
				libp2p: {
					peerId: await deserialize(
						new Uint8Array([
							0, 0, 193, 202, 95, 29, 8, 42, 238, 188, 32, 59, 103, 187, 192,
							93, 202, 183, 249, 50, 240, 175, 84, 87, 239, 94, 92, 9, 207, 165,
							88, 38, 234, 216, 0, 183, 243, 219, 11, 211, 12, 61, 235, 154, 68,
							205, 124, 143, 217, 234, 222, 254, 15, 18, 64, 197, 13, 62, 84,
							62, 133, 97, 57, 150, 187, 247, 215
						]),
						Ed25519Keypair
					).toPeerId()
				}
			},
			{
				libp2p: {
					peerId: await deserialize(
						new Uint8Array([
							0, 0, 235, 231, 83, 185, 72, 206, 24, 154, 182, 109, 204, 158, 45,
							46, 27, 15, 0, 173, 134, 194, 249, 74, 80, 151, 42, 219, 238, 163,
							44, 6, 244, 93, 0, 136, 33, 37, 186, 9, 233, 46, 16, 89, 240, 71,
							145, 18, 244, 158, 62, 37, 199, 0, 28, 223, 185, 206, 109, 168,
							112, 65, 202, 154, 27, 63, 15
						]),
						Ed25519Keypair
					).toPeerId()
				}
			},
			{
				libp2p: {
					peerId: await deserialize(
						new Uint8Array([
							0, 0, 132, 56, 63, 72, 241, 115, 159, 73, 215, 187, 97, 34, 23,
							12, 215, 160, 74, 43, 159, 235, 35, 84, 2, 7, 71, 15, 5, 210, 231,
							155, 75, 37, 0, 15, 85, 72, 252, 153, 251, 89, 18, 236, 54, 84,
							137, 152, 227, 77, 127, 108, 252, 59, 138, 246, 221, 120, 187,
							239, 56, 174, 184, 34, 141, 45, 242
						]),
						Ed25519Keypair
					).toPeerId()
				}
			}
		]);
		await session.connect([
			[session.peers[0], session.peers[1]],
			[session.peers[1], session.peers[2]]
		]);
		await session.peers[1].services.blocks.waitFor(session.peers[0].peerId);
		await session.peers[2].services.blocks.waitFor(session.peers[1].peerId);
	});

	after(async () => {
		await session.stop();
	});

	beforeEach(async () => {
	});

	afterEach(async () => {
		if (db1?.closed === false) {
			await db1?.drop();
		}
		if (db2?.closed === false) {
			await db2?.drop();
		}

	});

	it("none", async () => {
		db1 = await session.peers[0].open(new EventStore<string>());

		db2 = (await EventStore.open<EventStore<string>>(
			db1.address!,
			session.peers[1],
			{
				args: { replicate: false }
			}
		))!;

		await db1.waitFor(session.peers[1].peerId);

		await db1.add("hello");
		await db2.add("world");

		await waitFor(() => db1.log.log.length === 2); // db2 can write ...
		expect(
			(await db1.log.log.toArray()).map(
				(x) => x.payload.getValue().value
			)
		).to.have.members(["hello", "world"]);
		expect(db2.log.log.length).equal(1); // ... but will not receive entries
	});

	describe("observer", () => {
		it("can update", async () => {
			db1 = await session.peers[0].open(new EventStore<string>());

			expect(
				(db1.log.node.services.pubsub as any)["subscriptions"].get(db1.log.rpc.topic)
					.counter
			).equal(1);
			expect(
				[...await db1.log
					.getReplicators()]
			).to.deep.equal([db1.node.identity.publicKey.hashcode()]);
			expect(await db1.log.isReplicating()).to.be.true
			await db1.log.replicate(false);
			expect(await db1.log.isReplicating()).to.be.false;
			expect(
				(db1.log.node.services.pubsub as any)["subscriptions"].get(db1.log.rpc.topic)
					.counter
			).equal(1);
		});

		it("observer", async () => {
			db1 = await session.peers[0].open(new EventStore<string>());

			db2 = (await EventStore.open<EventStore<string>>(
				db1.address!,
				session.peers[1],
				{
					args: { replicate: false }
				}
			))!;

			await db1.waitFor(session.peers[1].peerId);

			await db1.add("hello");
			await db2.add("world");

			await waitFor(() => db1.log.log.length === 2); // db2 can write ...
			expect(
				(await db1.log.log.toArray()).map(
					(x) => x.payload.getValue().value
				)
			).to.have.members(["hello", "world"]);
			expect(db2.log.log.length).equal(1); // ... but will not receive entries
		});
	});

	describe("replictor", () => {


		it("fixed", async () => {
			db1 = await session.peers[0].open(new EventStore<string>(), {
				args: {
					replicate: {
						offset: 0.7,
						factor: 0.5
					}
				}
			});
			let ranges = await db1.log.getMyReplicationSegments();
			expect(ranges).to.have.length(1);
			expect(ranges[0].toReplicationRange().offset).to.closeTo(0.7, 0.000001);
			expect(ranges[0].toReplicationRange().factor).to.closeTo(0.5, 0.000001);
		});



		it("dynamic by default", async () => {
			db1 = await session.peers[0].open(new EventStore<string>());

			db2 = (await EventStore.open<EventStore<string>>(
				db1.address!,
				session.peers[1]
			))!;
			const roles: any[] = [];
			db2.log.events.addEventListener("replication:change", (change) => {
				if (
					change.detail.publicKey.equals(session.peers[1].identity.publicKey)
				) {
					roles.push(change.detail);
				}
			});
			/// expect role to update a few times
			await waitForResolved(() => expect(roles.length).greaterThan(3));
		});

		it("passing by string evens by default", async () => {
			db1 = await session.peers[0].open(new EventStore<string>());

			db2 = await EventStore.open<EventStore<string>>(

				db1.address!,
				session.peers[1],
				{
					args: {
						replicate: true
					}
				}
			);

			const roles: any[] = [];
			db2.log.events.addEventListener("replication:change", (change) => {
				if (
					change.detail.publicKey.equals(session.peers[1].identity.publicKey)
				) {
					roles.push(change.detail);
				}
			});
			/// expect role to update a few times
			await waitForResolved(() => expect(roles.length).greaterThan(3));
		});

		it("waitForReplicator waits until maturity", async () => {

			const store = new EventStore<string>();

			const db1 = await session.peers[0].open(store.clone(), {
				args: {
					replicate: {
						factor: 1
					}
				}
			});
			const db2 = await session.peers[1].open(store.clone(), {
				args: {
					replicate: {
						factor: 1
					}
				}
			});
			db2.log.getDefaultMinRoleAge = () => Promise.resolve(3e3);
			const t0 = +new Date();
			await db2.log.waitForReplicator(db1.node.identity.publicKey);
			const t1 = +new Date();
			expect(t1 - t0).greaterThan(await db2.log.getDefaultMinRoleAge());
		});
		describe("getDefaultMinRoleAge", () => {
			it("oldest is always mature", async () => {
				const store = new EventStore<string>();

				const db1 = await session.peers[0].open(store.clone(), {
					args: {
						replicate: {
							factor: 1
						}
					}
				});
				const tsm = 1000;

				await delay(tsm);

				const db2 = await session.peers[1].open(store.clone(), {
					args: {
						replicate: {
							factor: 1
						}
					}
				});
				await waitForResolved(async () =>
					expect(await db1.log.replicationIndex?.getSize()).equal(2)
				);
				await waitForResolved(async () =>
					expect(await db2.log.replicationIndex?.getSize()).equal(2)
				);

				const db1MinRoleAge = await db1.log.getDefaultMinRoleAge();
				const db2MinRoleAge = await db2.log.getDefaultMinRoleAge();

				expect(db1MinRoleAge - db2MinRoleAge).lessThanOrEqual(1); // db1 sets the minRole age because it is the oldest. So both dbs get same minRole age limit (including some error margin)

				const now = +new Date();

				// Mature because if "first"
				let selfMatured = isMatured(
					(await db1.log.getMyReplicationSegments())[0],
					now,
					await db1.log.getDefaultMinRoleAge()
				);
				expect(selfMatured).to.be.true;

				await waitForResolved(async () => {
					const minRoleAge = await db1.log.getDefaultMinRoleAge()
					expect(
						(await db1.log
							.replicationIndex.query(new SearchRequest())).results.map(x => x.value)
							.filter((x) =>
								isMatured(x, now, minRoleAge)
							)
							.map((x) => x.hash)
					).to.deep.equal([db1.node.identity.publicKey.hashcode()])
				});

				// assume other nodes except me are mature if the open before me
				selfMatured = isMatured(
					(await db2.log.getMyReplicationSegments())[0],
					now,
					await db2.log.getDefaultMinRoleAge()
				);
				expect(selfMatured).to.be.false;

				const minRoleAge = await db2.log.getDefaultMinRoleAge()
				expect(
					(await db2.log
						.replicationIndex.query(new SearchRequest({ fetch: 0xffffffff }))).results.map(x => x.value)
						.map((x) =>
							isMatured(x, now, minRoleAge)
						)
				).to.have.members([false, true]);

			});

			// TODO more tests for behaviours of getDefaultMinRoleAge
		});
	});
});
/* 
describe("segment", () => {
	describe("overlap", () => {
		it("non-wrapping", () => {
			const s1 = new ReplicationSegment({ offset: 0, factor: 0.5 });
			const s2 = new ReplicationSegment({ offset: 0.45, factor: 0.5 });
			expect(s1.overlaps(s2)).to.be.true;
			expect(s2.overlaps(s1)).to.be.true;
		});
		it("wrapped", () => {
			const s1 = new ReplicationSegment({ offset: 0.7, factor: 0.5 });
			const s2 = new ReplicationSegment({ offset: 0.2, factor: 0.2 });
			expect(s1.overlaps(s2)).to.be.true;
			expect(s2.overlaps(s1)).to.be.true;
		});

		it("inside", () => {
			const s1 = new ReplicationSegment({ offset: 0.7, factor: 0.5 });
			const s2 = new ReplicationSegment({ offset: 0.8, factor: 0.1 });
			expect(s1.overlaps(s2)).to.be.true;
			expect(s2.overlaps(s1)).to.be.true;
		});
		it("insde-wrapped", () => {
			const s1 = new ReplicationSegment({ offset: 0.7, factor: 0.5 });
			const s2 = new ReplicationSegment({ offset: 0.1, factor: 0.1 });
			expect(s1.overlaps(s2)).to.be.true;
			expect(s2.overlaps(s1)).to.be.true;
		});
	});
}); */

/* it("encrypted clock sync write 1 entry replicate false", async () => {
	await waitForPeers(session.peers[1], [client1.id], db1.address.toString());
	const encryptionKey = await client1.keystore.createEd25519Key({
		id: "encryption key",
		group: topic,
	});
	db2 = await client2.open<EventStore<string>>(
		await EventStore.load<EventStore<string>>(
			client2.libp2p.services.blocks,
			db1.address!
		),
		{ replicate: false }
	);

	await db1.add("hello", {
		receiver: {
			next: encryptionKey.keypair.publicKey,
			meta: encryptionKey.keypair.publicKey,
			payload: encryptionKey.keypair.publicKey,
			signatures: encryptionKey.keypair.publicKey,
		},
	});


	// Now the db2 will request sync clocks even though it does not replicate any content
	await db2.add("world");

	await waitFor(() => db1.store.oplog.length === 2);
	expect(
		db1.store.oplog.toArray().map((x) => x.payload.getValue().value)
	).to.have.members(["hello", "world"]);
	expect(db2.store.oplog.length).equal(1);
}); */
