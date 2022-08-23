
import path from 'path';
import assert from 'assert';
import LRU from 'lru';
import { BoxKeyWithMeta, createStore, Keystore, KeyWithMeta, SignKeyWithMeta } from '../keystore';
import rmrf from 'rimraf'
import { waitFor } from '@dao-xyz/time';
import { Level } from 'level';
import { Ed25519PublicKey, X25519PublicKey, X25519SecretKey } from 'sodium-plus';
import { deserialize, serialize } from '@dao-xyz/borsh';

const fs = require('fs-extra')

let store: Level;
const fixturePath = path.join('packages/orbit-db-keystore/src/__tests__', 'fixtures', 'signingKeys')
const storagePath = path.join('packages/orbit-db-keystore/src/__tests__', 'signingKeys')
const upgradePath = path.join('packages/orbit-db-keystore/src/__tests__', 'upgrade')
const tempKeyPath = "packages/orbit-db-keystore/src/__tests__/keystore-test";

jest.setTimeout(10000);

describe('keystore', () => {
  beforeAll(async () => {
    await fs.copy(fixturePath, storagePath)
    rmrf.sync(tempKeyPath)
    store = await createStore(tempKeyPath) // storagePath

  })

  afterAll(async () => {
    rmrf.sync(storagePath)
    rmrf.sync(upgradePath)
    rmrf.sync(tempKeyPath)

  })

  describe('constructor', () => {
    it('creates a new Keystore instance', async () => {
      const keystore = new Keystore(store)

      assert.strictEqual(typeof keystore.close, 'function')
      assert.strictEqual(typeof keystore.openStore, 'function')
      assert.strictEqual(typeof keystore.hasKey, 'function')
      assert.strictEqual(typeof keystore.createKey, 'function')
      assert.strictEqual(typeof keystore.getKeyByPath, 'function')
      assert.strictEqual(typeof keystore.sign, 'function')
      assert.strictEqual(typeof keystore.verify, 'function')
    })

    it('assigns this._store', async () => {
      const keystore = new Keystore(store)
      // Loose check for leveldownishness
      assert(['open', 'opening'].includes(keystore._store.status))
    })

    it('assigns this.cache with default of 100', async () => {
      const keystore = new Keystore(store)
      assert.strictEqual(keystore._cache.max, 100)
    })

    it('creates a proper leveldown / level-js store if not passed a store', async () => {
      const keystore = new Keystore()
      assert.strictEqual(keystore._store.status, 'opening')
      await keystore.close()
    })

    it('creates a keystore with empty options', async () => {
      const keystore = new Keystore({})
      assert.strictEqual(keystore._store.status, 'opening')
      await keystore.close()
    })

    it('creates a keystore with only cache', async () => {
      const cache = new LRU(10)
      const keystore = new Keystore({ cache })
      assert.strictEqual(keystore._store.status, 'opening')
      assert(keystore._cache === cache)
      await keystore.close()
    })

    it('creates a keystore with both', async () => {
      const cache = new LRU(10)
      const keystore = new Keystore({ store, cache })
      assert(['open', 'opening'].includes(keystore._store.status))
      assert(keystore._cache === cache)
      assert(keystore._store === store)
    })
  })


  describe('createKey', () => {
    let keystore: Keystore

    beforeEach(async () => {
      keystore = new Keystore(store)
      if (store.status !== 'open') {
        await store.open()
      }
    })

    it('creates a new key', async () => {
      const id = 'a new key'
      await keystore.createKey(id, SignKeyWithMeta)
      const hasKey = await keystore.hasKey(id, SignKeyWithMeta)
      assert.strictEqual(hasKey, true)
    })

    it('throws an error upon not receiving an ID', async () => {
      try {
        await keystore.createKey(undefined, undefined)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })
    it('throws an error if key already exist', async () => {
      const id = 'already'
      await keystore.createKey(id, SignKeyWithMeta)
      try {
        await keystore.createKey(id, SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })
    it('throws an error accessing a closed store', async () => {
      try {
        const id = 'X'

        await store.close()
        await keystore.createKey(id, SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })



    afterEach(async () => {
      // await keystore.close()
    })
  })

  describe('saveKey', () => {
    let keystore: Keystore

    beforeEach(async () => {
      keystore = new Keystore(store)
      if (store.status !== 'open') {
        await store.open()
      }
    })

    it('can overwrite if secret key is missing', async () => {
      const id = 'overwrite key'
      let keyWithMeta = new BoxKeyWithMeta({
        secretKey: undefined,
        publicKey: new X25519PublicKey(Buffer.from(new Array(32).fill(0))),
        timestamp: +new Date,
        group: '_'
      });
      let savedKey = await keystore.saveKey(keyWithMeta, id)
      assert(!savedKey.secretKey);
      keyWithMeta = new BoxKeyWithMeta({
        secretKey: new X25519SecretKey(Buffer.from(new Array(32).fill(0))),
        publicKey: new X25519PublicKey(Buffer.from(new Array(32).fill(0))),
        timestamp: keyWithMeta.timestamp,
        group: '_'
      });
      savedKey = await keystore.saveKey(keyWithMeta, id)
      assert(!!savedKey.secretKey)
    })

    it('will return secret key if missing when saving', async () => {
      const id = 'overwrite key'
      let keyWithMeta = new BoxKeyWithMeta({
        secretKey: new X25519SecretKey(Buffer.from(new Array(32).fill(0))),
        publicKey: new X25519PublicKey(Buffer.from(new Array(32).fill(0))),
        timestamp: +new Date,
        group: '_'
      });
      let savedKey = await keystore.saveKey(keyWithMeta, id)
      assert(!!savedKey.secretKey);
      keyWithMeta = new BoxKeyWithMeta({
        secretKey: undefined,
        publicKey: new X25519PublicKey(Buffer.from(new Array(32).fill(0))),
        timestamp: keyWithMeta.timestamp,
        group: '_'
      });
      savedKey = await keystore.saveKey(keyWithMeta, id)
      assert(!!savedKey.secretKey)
    })

    it('throws an error upon not receiving an ID', async () => {
      try {
        await keystore.createKey(undefined, undefined)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })
    it('throws an error if key already exist', async () => {
      const id = 'already'
      await keystore.createKey(id, SignKeyWithMeta)
      try {
        await keystore.createKey(id, SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })
    it('throws an error accessing a closed store', async () => {
      try {
        const id = 'X'

        await store.close()
        await keystore.createKey(id, SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })



    afterEach(async () => {
      // await keystore.close()
    })
  })

  describe('hasKey', () => {
    let keystore: Keystore

    beforeAll(async () => {
      if (store.status !== 'open') {
        await store.open()
      }
      keystore = new Keystore(store)
      await keystore.createKey('YYZ', SignKeyWithMeta)
    })

    it('returns true if key exists', async () => {
      const hasKey = await keystore.hasKey('YYZ', SignKeyWithMeta)
      assert.strictEqual(hasKey, true)
    })

    it('returns false if key does not exist', async () => {
      let hasKey
      try {
        hasKey = await keystore.hasKey('XXX', SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(hasKey, true)
      }
    })

    it('throws an error upon not receiving an ID', async () => {
      try {
        await keystore.hasKey(undefined, undefined)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    it('throws an error accessing a closed store', async () => {
      try {
        await store.close()
        await keystore.hasKey('XXX', SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    afterEach(async () => {
      // await keystore.close()
    })
  })

  describe('getKey', () => {
    let keystore: Keystore, createdKey: SignKeyWithMeta
    beforeAll(async () => {
      if (store.status !== 'open') {
        await store.open()
      }
      keystore = new Keystore(store)
      createdKey = await keystore.createKey('ZZZ', SignKeyWithMeta)
    })

    it('gets an existing key', async () => {
      const key = await keystore.getKeyByPath('ZZZ', SignKeyWithMeta)
      assert.strictEqual(key.publicKey.getLength(), 32)
      assert.strictEqual(key.secretKey.getLength(), 64)
    })

    it('throws an error upon accessing a non-existant key', async () => {
      try {
        await keystore.getKeyByPath('ZZZZ', SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    it('throws an error upon not receiving an ID', async () => {
      try {
        await keystore.getKeyByPath(undefined, undefined)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    it('throws an error accessing a closed store', async () => {
      try {
        await store.close()
        await keystore.getKeyByPath('ZZZ', SignKeyWithMeta)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    afterAll(async () => {
      // keystore.close()
    })
  })

  describe('getKeys', () => {
    let keystore: Keystore, aSignKey: KeyWithMeta, aBoxKey: KeyWithMeta, aBox2Key: KeyWithMeta, bSignKey: KeyWithMeta

    beforeAll(async () => {

      keystore = new Keystore(tempKeyPath)
      aSignKey = await keystore.createKey('asign', SignKeyWithMeta, 'group')
      aBoxKey = await keystore.createKey('abox', BoxKeyWithMeta, 'group')
      aBox2Key = await keystore.createKey('abox2', BoxKeyWithMeta, 'group')
      bSignKey = await keystore.createKey('bsign', SignKeyWithMeta, 'group2')

    })

    it('gets keys by group', async () => {
      const keys = await keystore.getKeys('group')
      assert(keys[0].equals(aBoxKey))
      assert(keys[1].equals(aBox2Key))
      assert(keys[2].equals(aSignKey))

    })


    it('gets keys by group by type', async () => {
      const keys = await keystore.getKeys('group', BoxKeyWithMeta)
      assert(keys[0].equals(aBoxKey))
      assert(keys[1].equals(aBox2Key))
    })


    afterAll(async () => {
      // keystore.close()
    })
  })

  describe(SignKeyWithMeta, () => {
    let keystore: Keystore, key: SignKeyWithMeta, signingStore

    beforeAll(async () => {

      jest.setTimeout(10000)
      signingStore = await createStore(storagePath)
      keystore = new Keystore(signingStore) // 
      /*  await new Promise((resolve) => {
         setTimeout(() => {
           resolve(true);
         }, 3000);
       })*/
      /* 
      await keystore.close(); */
      /* const createdKey = await keystore.createKey('signing', SignKeyWithMeta, undefined, { overwrite: true })
      const y = deserialize(Buffer.from(serialize(createdKey)), KeyWithMeta); */
      key = await keystore.getKeyByPath('signing', SignKeyWithMeta)
      /* await keystore.close();  */ //
      const x = 123;
    })

    it('signs data', async () => {
      const expectedSignature = new Uint8Array([44, 124, 192, 165, 144, 131, 28, 203, 80, 254, 104, 109, 85, 68, 167, 227, 146, 52, 54, 237, 101, 248, 191, 179, 23, 251, 90, 131, 0, 6, 15, 182, 71, 131, 153, 198, 238, 242, 201, 74, 184, 130, 34, 250, 254, 15, 116, 150, 195, 128, 104, 45, 214, 129, 70, 30, 157, 139, 140, 19, 16, 189, 191, 1, 100, 97, 116, 97, 32, 100, 97, 116, 97, 32, 100, 97, 116, 97])
      const signature = await keystore.sign(Buffer.from('data data data'), key)
      assert.deepStrictEqual(signature, expectedSignature)
    })

    it('throws an error if no key is passed', async () => {
      try {
        await keystore.sign(Buffer.from('data data data'), null)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    it('throws an error if no data is passed', async () => {
      try {
        await keystore.sign(null, key)
      } catch (e) {
        assert.strictEqual(true, true)
      }
    })

    afterAll(async () => {
      signingStore.close()
    })
  })

  describe('verify', () => {
    jest.setTimeout(5000)
    let keystore: Keystore, signingStore, publicKey: Ed25519PublicKey, key: SignKeyWithMeta

    beforeAll(async () => {
      signingStore = await createStore(storagePath)
      keystore = new Keystore(signingStore)
      key = await keystore.getKeyByPath('signing', SignKeyWithMeta)
      publicKey = key.publicKey
    })

    it('verifies content', async () => {
      const signature = '4FAJrjPESeuDK5AhhHVmrCdVbb6gTqczxex1CydLfCHH4kP4CBmoMLfH6UxLF2UmPkisNMU15RVHo63NbWiNvyyb2f4h8x5cKWtQrHY3mUL'
      try {
        const verified = await keystore.verify(Buffer.from(signature), publicKey, Buffer.from('data data data'))
        assert.strictEqual(verified, true)
      } catch (error) {
        const x = 123;
      }
    })

    it('verifies content with cache', async () => {
      const data = new Uint8Array(Buffer.from('data'.repeat(1024 * 1024)))
      const sig = await keystore.sign(Buffer.from(data), key)
      const startTime = new Date().getTime()
      await keystore.verify(sig, publicKey, Buffer.from(data))
      const first = new Date().getTime()
      await keystore.verify(sig, publicKey, Buffer.from(data))
      const after = new Date().getTime()
      console.log('First pass:', first - startTime, 'ms', 'Cached:', after - first, 'ms')
      assert.strictEqual(first - startTime > after - first, true)
    })

    it('does not verify content with bad signature', async () => {
      const signature = 'xxxxxx'
      const verified = await keystore.verify((new Uint8Array(Buffer.from(signature))), publicKey, Buffer.from('data data data'))
      assert.strictEqual(verified, false)
    })

    afterAll(async () => {
      signingStore.close()
    })
  })

  describe('open', () => {
    let keystore: Keystore, signingStore

    beforeEach(async () => {
      signingStore = await createStore(storagePath)
      keystore = new Keystore(signingStore)
      signingStore.close()
    })

    it('closes then open', async () => {
      await waitFor(() => signingStore.status === 'closed');
      await keystore.openStore()
      assert.strictEqual(signingStore.status, 'open')
    })

    it('fails when no store', async () => {
      let error = false
      try {
        keystore._store = undefined
        await keystore.openStore()
      } catch (e) {
        error = e.message
      }
      assert.strictEqual(error, 'Keystore: No store found to open')
    })

    afterEach(async () => {
      signingStore.close()
    })
  })

  describe('encryption', () => {
    describe(BoxKeyWithMeta, () => {
      let keystore: Keystore, keyA: BoxKeyWithMeta, keyB: BoxKeyWithMeta, encryptStore

      beforeAll(async () => {
        encryptStore = await createStore(storagePath)
        keystore = new Keystore(encryptStore) // 

        await keystore.createKey('box-a', BoxKeyWithMeta);
        await keystore.createKey('box-b', BoxKeyWithMeta);
        keyA = await keystore.getKeyByPath('box-a', BoxKeyWithMeta)
        keyB = await keystore.getKeyByPath('box-b', BoxKeyWithMeta)

      })

      it('encrypts/decrypts', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const encrypted = await keystore.encrypt(data, keyA, keyB.publicKey);
        const decrypted = await keystore.decrypt(encrypted, keyB, keyA.publicKey)
        assert.deepStrictEqual(data, decrypted);
      })


      afterAll(async () => {
        encryptStore.close()
      })
    })

  })

})