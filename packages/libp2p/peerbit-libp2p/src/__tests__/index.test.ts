import { createLibp2pExtended } from "..";
it("starts", async () => {
	const node = await createLibp2pExtended({});
	await node.start();
	expect(node.getMultiaddrs()).toHaveLength(2);
	await node.stop();
});
