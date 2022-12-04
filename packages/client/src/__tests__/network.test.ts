//
import rmrf from "rimraf";
import { Peerbit } from "../peer";

import { EventStore } from "./utils/stores/event-store";
import { jest } from "@jest/globals";

// Include test utilities
import { LSession } from "@dao-xyz/peerbit-test-utils";

import { TrustedNetwork } from "@dao-xyz/peerbit-trusted-network";
import { delay, waitFor } from "@dao-xyz/peerbit-time";
import { AccessError, Ed25519Keypair } from "@dao-xyz/peerbit-crypto";
import { PermissionedEventStore } from "./utils/stores/test-store";
import { DEFAULT_BLOCK_TRANSPORT_TOPIC } from "@dao-xyz/peerbit-block";

describe(`network`, function () {
    let session: LSession;
    let orbitdb1: Peerbit,
        orbitdb2: Peerbit,
        orbitdb3: Peerbit,
        db1: EventStore<string>,
        db2: EventStore<string>,
        db3: EventStore<string>;

    beforeAll(async () => {
        session = await LSession.connected(3, [DEFAULT_BLOCK_TRANSPORT_TOPIC]);
    });

    afterAll(async () => {
        await session.stop();
    });

    beforeEach(async () => {
        orbitdb1 = await Peerbit.create(session.peers[0], {});
        orbitdb2 = await Peerbit.create(session.peers[1], {});
        orbitdb3 = await Peerbit.create(session.peers[2], {});
    });

    afterEach(async () => {
        if (db1) await db1.drop();

        if (db2) await db2.drop();

        if (db3) await db3.drop();

        if (orbitdb1) await orbitdb1.stop();

        if (orbitdb2) await orbitdb2.stop();

        if (orbitdb3) await orbitdb3.stop();
    });
    it("_", () => {});

    /*  TODO
    
    it("will not recieved heads if not trusted", async () => {
         const network = new TrustedNetwork({
             id: "network-tests",
             rootTrust: orbitdb1.identity.publicKey,
         });
         const program = await orbitdb1.open(
             new PermissionedEventStore({ network }),
             { directory: dbPath1 }
         );
         await orbitdb1.join(program);

         // trust client 3
         await program.network.add(orbitdb3.id); // we have to trust peer because else other party will not exchange heads
         await program.network.add(orbitdb3.identity.publicKey); // will have to trust identity because else this can t add more idenetities

         // but only partially trust client 2
         await program.network.add(orbitdb2.identity.publicKey); // omitt adding trust to orbitdb2 peer id, so we can test that it does not recieve heads
         await waitFor(() => program.network.trustGraph.index.size === 4);

         const program2 = await orbitdb2.open<PermissionedEventStore>(
             program.address!,
             { directory: dbPath2 }
         );
         const program3 = await orbitdb3.open<PermissionedEventStore>(
             program.address!,
             { directory: dbPath3 }
         );
         await waitFor(() => orbitdb1._directConnections.size === 2);

         await waitFor(() => program3.network.trustGraph.index.size === 4);

         expect(program2.network.trustGraph.index.size).toEqual(0); // because peer id is not trusted so it will not recieve heads
         await orbitdb3.join(program3); // will add relation form client 3 to peer id 3 (it also exist another relation from client 1 to peer id 3 btw, but these are not the same)

         expect(() => orbitdb2.join(program2)).rejects.toThrow(AccessError);

         // Do two additional writes from trusted client 1 and 3
         await program.network.add(
             (
                 await Ed25519Keypair.create()
             ).publicKey
         );
         await program3.network.add(
             (
                 await Ed25519Keypair.create()
             ).publicKey
         );
         await waitFor(() => program.network.trustGraph.index.size === 7);
         await waitFor(() => program3.network.trustGraph.index.size === 7);

         await delay(2000); // arb. delay
         expect(program2.network.trustGraph.index.size).toEqual(0); // because peer id is not trusted so it will not recieve heads
     }); */
});
