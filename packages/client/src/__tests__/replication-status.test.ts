
import { OrbitDB } from "../orbit-db"
import { SimpleAccessController } from "./utils/access"
import { EventStore } from "./utils/stores/event-store"

import assert from 'assert'
import rmrf from 'rimraf'

// Include test utilities
const {
  config,
  startIpfs,
  stopIpfs,
  testAPIs,
} = require('@dao-xyz/orbit-db-test-utils')

const dbPath1 = './orbitdb/tests/create-open/1'
const dbPath2 = './orbitdb/tests/create-open/2'

Object.keys(testAPIs).forEach(API => {
  describe(`orbit-db - Replication Status (${API})`, function () {
    jest.setTimeout(config.timeout)

    let ipfsd: Controller, ipfs: IPFS, orbitdb1: OrbitDB, orbitdb2: OrbitDB, db: EventStore<string>

    beforeAll(async () => {
      rmrf.sync(dbPath1)
      rmrf.sync(dbPath2)
      ipfsd = await startIpfs(API, config.daemon1)
      ipfs = ipfsd.api
      orbitdb1 = await OrbitDB.createInstance(ipfs, { directory: dbPath1 })
      orbitdb2 = await OrbitDB.createInstance(ipfs, { directory: dbPath2 })
      db = await orbitdb1.open(new EventStore<string>({ name: 'replication status tests', accessController: new SimpleAccessController() })
      )
    })

    afterAll(async () => {
      if (orbitdb1)
        await orbitdb1.stop()

      if (orbitdb2)
        await orbitdb2.stop()

      if (ipfsd)
        await stopIpfs(ipfsd)
    })

    it('has correct initial state', async () => {
      assert.deepEqual(db.replicationStatus, { progress: 0, max: 0 })
    })

    it('has correct replication info after load', async () => {
      await db.add('hello')
      await db.close()
      await db.load()
      assert.deepEqual(db.replicationStatus, { progress: 1, max: 1 })
      await db.close()
    })

    it('has correct replication info after close', async () => {
      await db.close()
      assert.deepEqual(db.replicationStatus, { progress: 0, max: 0 })
    })

    it('has correct replication info after sync', async () => {
      await db.load()
      await db.add('hello2')

      const db2 = await orbitdb2.open(await EventStore.load(orbitdb2._ipfs, db.address))
      await db2.sync(db._oplog.heads)

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            assert.deepEqual(db2.replicationStatus, { progress: 2, max: 2 })
            resolve(true)
          } catch (e: any) {
            reject(e)
          }
        }, 100)
      })
    })

    it('has correct replication info after loading from snapshot', async () => {
      await db._cache._store.open()
      await db.saveSnapshot()
      await db.close()
      await db.loadFromSnapshot()
      assert.deepEqual(db.replicationStatus, { progress: 2, max: 2 })
    })
  })
})