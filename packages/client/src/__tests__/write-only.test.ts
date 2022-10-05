
import assert from 'assert'
import rmrf from 'rimraf'
import { Entry, LamportClock } from '@dao-xyz/ipfs-log-entry'
import { BoxKeyWithMeta } from '@dao-xyz/orbit-db-keystore'
import { Store } from '@dao-xyz/orbit-db-store'
import { delay, waitFor } from '@dao-xyz/time'

import { OrbitDB } from '../orbit-db'
import { SimpleAccessController } from './utils/access'
import { EventStore, Operation } from './utils/stores/event-store'

// Include test utilities
const {
    config,
    startIpfs,
    stopIpfs,
    testAPIs,
    connectPeers,
    waitForPeers,
} = require('@dao-xyz/orbit-db-test-utils')

const orbitdbPath1 = './orbitdb/tests/replication/1'
const orbitdbPath2 = './orbitdb/tests/replication/2'
const dbPath1 = './orbitdb/tests/replication/1/db1'
const dbPath2 = './orbitdb/tests/replication/2/db2'


Object.keys(testAPIs).forEach(API => {
    describe(`orbit-db - Replication (${API})`, function () {
        jest.setTimeout(config.timeout * 2)

        let ipfsd1, ipfsd2, ipfs1, ipfs2
        let orbitdb1: OrbitDB, orbitdb2: OrbitDB, db1: EventStore<string>, db2: EventStore<string>

        let timer

        beforeAll(async () => {
            ipfsd1 = await startIpfs(API, config.daemon1)
            ipfsd2 = await startIpfs(API, config.daemon2)
            ipfs1 = ipfsd1.api
            ipfs2 = ipfsd2.api
            // Connect the peers manually to speed up test times
            const isLocalhostAddress = (addr) => addr.toString().includes('127.0.0.1')
            await connectPeers(ipfs1, ipfs2, { filter: isLocalhostAddress })
            console.log("Peers connected")
        })

        afterAll(async () => {
            if (ipfsd1)
                await stopIpfs(ipfsd1)

            if (ipfsd2)
                await stopIpfs(ipfsd2)
        })

        beforeEach(async () => {
            clearInterval(timer)

            rmrf.sync(orbitdbPath1)
            rmrf.sync(orbitdbPath2)
            rmrf.sync(dbPath1)
            rmrf.sync(dbPath2)

            orbitdb1 = await OrbitDB.createInstance(ipfs1, {
                directory: orbitdbPath1, canAccessKeys: async (requester, _keyToAccess) => {
                    return requester.equals(orbitdb2.publicKey); // allow orbitdb1 to share keys with orbitdb2
                }, waitForKeysTimout: 1000
            })
            orbitdb2 = await OrbitDB.createInstance(ipfs2, { directory: orbitdbPath2 })
            db1 = await orbitdb1.open(new EventStore<string>({
                name: 'abc',
                accessController: new SimpleAccessController()
            }), { directory: dbPath1, encryption: orbitdb1.replicationTopicEncryption() })
        })

        afterEach(async () => {
            clearInterval(timer)

            if (db1)
                await db1.drop()

            if (db2)
                await db2.drop()

            if (orbitdb1)
                await orbitdb1.stop()

            if (orbitdb2)
                await orbitdb2.stop()
        })

        it('write 1 entry replicate false', async () => {
            console.log("Waiting for peers to connect")
            await waitForPeers(ipfs2, [orbitdb1.id], db1.address.toString())
            db2 = await orbitdb2.open<EventStore<string>>(await EventStore.load(orbitdb2._ipfs, db1.address), { directory: dbPath2, replicate: false, encryption: undefined })

            await db1.add('hello');
            /*   await waitFor(() => db2._oplog.clock.time > 0); */
            await db2.add('world');

            await waitFor(() => db1.oplog.values.length === 2);
            expect(db1.oplog.values.map(x => x.payload.value.value)).toContainAllValues(['hello', 'world'])
            expect(db2.oplog.values.length).toEqual(1);

        })

        it('encrypted clock sync write 1 entry replicate false', async () => {
            console.log("Waiting for peers to connect")
            await waitForPeers(ipfs2, [orbitdb1.id], db1.address.toString())
            const encryptionKey = await orbitdb1.keystore.createKey('encryption key', BoxKeyWithMeta, db1.replicationTopic);
            db2 = await orbitdb2.open<EventStore<string>>(await EventStore.load(orbitdb2._ipfs, db1.address), { directory: dbPath2, replicate: false, encryption: orbitdb2.replicationTopicEncryption() })

            await db1.add('hello', {
                reciever: {
                    clock: encryptionKey.publicKey,
                    publicKey: encryptionKey.publicKey,
                    payload: encryptionKey.publicKey,
                    signature: encryptionKey.publicKey
                }
            });

            /*   await waitFor(() => db2._oplog.clock.time > 0); */

            // Now the db2 will request sync clocks even though it does not replicate any content
            await db2.add('world');

            await waitFor(() => db1.oplog.values.length === 2);
            expect(db1.oplog.values.map(x => x.payload.value.value)).toContainAllValues(['hello', 'world'])
            expect(db2.oplog.values.length).toEqual(1);
        })

        it('will open store on exchange heads message', async () => {

            const replicationTopic = 'x';
            const store = new EventStore<string>({ name: 'replication-tests', accessController: new SimpleAccessController() });
            await orbitdb2.subscribeForReplicationStart(replicationTopic);
            await orbitdb1.open(store, { replicate: false, replicationTopic }); // this would be a "light" client, write -only

            const hello = await store.add('hello', { nexts: [] });
            const world = await store.add('world', { nexts: [hello] });

            expect(store.oplog.heads).toHaveLength(1);

            await waitFor(() => Object.values(orbitdb2.stores[replicationTopic]).length > 0, { timeout: 20 * 1000, delayInterval: 50 });

            const replicatedStore = Object.values(orbitdb2.stores[replicationTopic])[0];
            await waitFor(() => replicatedStore.oplog.values.length == 2);
            expect(replicatedStore).toBeDefined();
            expect(replicatedStore.oplog.heads).toHaveLength(1);
            expect(replicatedStore.oplog.heads[0].hash).toEqual(world.hash);

        })
    })
})