// This more like a playground as of now
// No tests yet,
import { LSession } from "@peerbit/test-utils";
import { jest } from "@jest/globals";

describe("server", () => {
	let session: LSession;
	jest.setTimeout(60 * 1000);

	beforeAll(async () => {
		session = await LSession.connected(1);
	});

	afterAll(async () => {
		await session.stop();
	});
	it("_", () => {
		expect(1).toEqual(1);
	});
	/*     it("x", async () => {
			const program = new PermissionedString({
				store: new DString({}),
				network: new TrustedNetwork({ rootTrust: peer.identity.publicKey }),
			});
			program.setupIndices();
			const base542 = Buffer.from(serialize(program)).toString("base64");
			const t = 123;
		}); */
});
