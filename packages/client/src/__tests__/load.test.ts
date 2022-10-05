
import assert from 'assert'
import pMapSeries from 'p-map-series'
import rmrf from 'rimraf'
import path from 'path'
import { Address } from '@dao-xyz/orbit-db-store'
import { OrbitDB } from '../orbit-db.js'
import { SimpleAccessController } from './utils/access.js'
import { EventStore, Operation } from './utils/stores/event-store.js'
const Cache = require('@dao-xyz/orbit-db-cache')
const localdown = require('localstorage-down')

// Include test utilities
import {
  config,
  startIpfs,
  stopIpfs
} from '@dao-xyz/orbit-db-test-utils'

const dbPath = './orbitdb/tests/persistency'

const tests = [
  {
    title: 'Persistency',
    type: undefined,
    orbitDBConfig: { directory: path.join(dbPath, '1') }
  }/* ,
  {
    title: 'Persistency with custom cache',
    type: "custom",
    orbitDBConfig: { directory: path.join(dbPath, '2') }
  } */
]
const API = 'js-ipfs';
const test = tests[0];
/* tests.forEach(test => {*/
describe(`orbit-db - load (js-ipfs)`, function () { //${test.title}
  jest.setTimeout(config.timeout)

  const entryCount = 65

  let ipfsd: Controller, ipfs: IPFS, orbitdb1: OrbitDB, db: EventStore<string>, address

  beforeAll(async () => {
    const options: any = Object.assign({}, test.orbitDBConfig)
    rmrf.sync(dbPath)
    ipfsd = await startIpfs(API, config.daemon1)
    ipfs = ipfsd.api
    orbitdb1 = await OrbitDB.createInstance(ipfs, options)
  })

  afterAll(async () => {
    if (orbitdb1)
      await orbitdb1.stop()

    if (ipfsd)
      await stopIpfs(ipfsd)
  })

  describe('load', function () {
    beforeEach(async () => {
      const dbName = new Date().getTime().toString()
      const entryArr = []

      for (let i = 0; i < entryCount; i++)
        entryArr.push(i)

      db = await orbitdb1.open(new EventStore<string>({ name: dbName, accessController: new SimpleAccessController() }))
      address = db.address.toString()
      await mapSeries(entryArr, (i) => db.add('hello' + i))
      await db.close()
      db = null
    })

    afterEach(async () => {
      await db?.drop()
    })

    it('loads database from local cache', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      await db.load()
      const items = db.iterator({ limit: -1 }).collect()
      expect(items.length).toEqual(entryCount)
      expect(items[0].payload.value.value).toEqual('hello0')
      expect(items[items.length - 1].payload.value.value).toEqual('hello' + (entryCount - 1))
    })

    it('loads database partially', async () => {
      const amount = 33
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      await db.load(amount)
      const items = db.iterator({ limit: -1 }).collect()
      expect(items.length).toEqual(amount)
      expect(items[0].payload.value.value).toEqual('hello' + (entryCount - amount))
      expect(items[1].payload.value.value).toEqual('hello' + (entryCount - amount + 1))
      expect(items[items.length - 1].payload.value.value).toEqual('hello' + (entryCount - 1))
    })

    it('load and close several times', async () => {
      const amount = 8
      for (let i = 0; i < amount; i++) {
        db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
        await db.load()
        const items = db.iterator({ limit: -1 }).collect()
        expect(items.length).toEqual(entryCount)
        expect(items[0].payload.value.value).toEqual('hello0')
        expect(items[1].payload.value.value).toEqual('hello1')
        expect(items[items.length - 1].payload.value.value).toEqual('hello' + (entryCount - 1))
        await db.close()
      }
    })

    /* it('closes database while loading', async () => { TODO fix
      db = await orbitdb1.open(address, { type: EVENT_STORE_TYPE, replicationConcurrency: 1 })
      return new Promise(async (resolve, reject) => {
        // don't wait for load to finish
        db.load()
          .then(() => reject("Should not finish loading?"))
          .catch(e => {
            if (e.toString() !== 'ReadError: Database is not open') {
              reject(e)
            } else {
              expect(db._cache._store).toEqual( null)
              resolve(true)
            }
          })
        await db.close()
      })
    }) */

    it('load, add one, close - several times', async () => {
      const amount = 8
      for (let i = 0; i < amount; i++) {
        db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
        await db.load()
        await db.add('hello' + (entryCount + i))
        const items = db.iterator({ limit: -1 }).collect()
        expect(items.length).toEqual(entryCount + i + 1)
        expect(items[items.length - 1].payload.value.value).toEqual('hello' + (entryCount + i))
        await db.close()
      }
    })

    it('loading a database emits \'ready\' event', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      return new Promise(async (resolve) => {
        db.events.on('ready', () => {
          const items = db.iterator({ limit: -1 }).collect()
          expect(items.length).toEqual(entryCount)
          expect(items[0].payload.value.value).toEqual('hello0')
          expect(items[items.length - 1].payload.value.value).toEqual('hello' + (entryCount - 1))
          resolve(true)
        })
        await db.load()
      })
    })

    it('loading a database emits \'load.progress\' event', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      return new Promise(async (resolve, reject) => {
        let count = 0
        db.events.on('load.progress', (address, hash, entry) => {
          count++
          try {
            expect(address).toEqual(db.address.toString())

            const { progress, max } = db.replicationStatus
            expect(max).toEqual(entryCount)
            expect(progress).toEqual(count)

            assert.notEqual(hash, null)
            assert.notEqual(entry, null)

            if (progress === BigInt(entryCount) && count === entryCount) {
              setTimeout(() => {
                resolve(true)
              }, 200)
            }
          } catch (e: any) {
            reject(e)
          }
        })
        // Start loading the database
        await db.load()
      })
    })
  })

  describe('load from empty snapshot', function () {
    it('loads database from an empty snapshot', async () => {
      db = await orbitdb1.open(new EventStore<string>({ name: 'empty-snapshot', accessController: new SimpleAccessController() }))
      address = db.address.toString()
      await db.saveSnapshot()
      await db.close()

      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      await db.loadFromSnapshot()
      const items = db.iterator({ limit: -1 }).collect()
      expect(items.length).toEqual(0)
    })
  })

  describe('load from snapshot', function () {
    beforeEach(async () => {
      const dbName = new Date().getTime().toString()
      const entryArr = []

      for (let i = 0; i < entryCount; i++)
        entryArr.push(i)

      db = await orbitdb1.open(new EventStore<string>({ name: dbName, accessController: new SimpleAccessController() }))
      address = db.address.toString()
      await mapSeries(entryArr, (i) => db.add('hello' + i))
      await db.saveSnapshot()
      await db.close()
      db = null
    })

    afterEach(async () => {
      await db?.drop()
    })

    it('loads database from snapshot', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      await db.loadFromSnapshot()
      const items = db.iterator({ limit: -1 }).collect()
      expect(items.length).toEqual(entryCount)
      expect(items[0].payload.value.value).toEqual('hello0')
      expect(items[entryCount - 1].payload.value.value).toEqual('hello' + (entryCount - 1))
    })

    it('load, add one and save snapshot several times', async () => {
      const amount = 4
      for (let i = 0; i < amount; i++) {
        db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
        await db.loadFromSnapshot()
        await db.add('hello' + (entryCount + i))
        const items = db.iterator({ limit: -1 }).collect()
        expect(items.length).toEqual(entryCount + i + 1)
        expect(items[0].payload.value.value).toEqual('hello0')
        expect(items[items.length - 1].payload.value.value).toEqual('hello' + (entryCount + i))
        await db.saveSnapshot()
        await db.close()
      }
    })

    it('throws an error when trying to load a missing snapshot', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      await db.drop()
      db = null
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))

      let err
      try {
        await db.loadFromSnapshot()
      } catch (e: any) {
        err = e.toString()
      }
      expect(err).toEqual(`Error: Snapshot for ${address} not found!`)
    })

    it('loading a database emits \'ready\' event', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      return new Promise(async (resolve) => {
        db.events.on('ready', () => {
          const items = db.iterator({ limit: -1 }).collect()
          expect(items.length).toEqual(entryCount)
          expect(items[0].payload.value.value).toEqual('hello0')
          expect(items[entryCount - 1].payload.value.value).toEqual('hello' + (entryCount - 1))
          resolve(true)
        })
        await db.loadFromSnapshot()
      })
    })

    it('loading a database emits \'load.progress\' event', async () => {
      db = await orbitdb1.open(await EventStore.load(orbitdb1._ipfs, Address.parse(address)))
      return new Promise(async (resolve, reject) => {
        let count = 0
        db.events.on('load.progress', (address, hash, entry) => {
          count++
          try {
            expect(address).toEqual(db.address.toString())

            const { progress, max } = db.replicationStatus
            expect(max).toEqual(entryCount)
            expect(progress).toEqual(count)

            assert.notEqual(hash, null)
            assert.notEqual(entry, null)
            if (progress === BigInt(entryCount) && count === entryCount) {
              resolve(true)
            }
          } catch (e: any) {
            reject(e)
          }
        })
        // Start loading the database
        await db.loadFromSnapshot()
      })
    })
  })
})
/* }) */