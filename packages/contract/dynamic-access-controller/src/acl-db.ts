import { field, variant } from '@dao-xyz/borsh';
import { BinaryDocumentStore, Operation } from '@dao-xyz/peerbit-ddoc';
import { getPathGenerator, TrustedNetwork, getFromByTo, RelationContract } from '@dao-xyz/peerbit-trusted-network';
import { Access, AccessData, AccessType } from './access';
import { Entry, Identity, Payload } from '@dao-xyz/ipfs-log'
import { MaybeEncrypted, PublicSignKey, SignatureWithKey } from '@dao-xyz/peerbit-crypto';
import { Address, EntryWithRefs, StoreLike } from '@dao-xyz/peerbit-dstore';
import { Log } from '@dao-xyz/ipfs-log';
// @ts-ignore
import { v4 as uuid } from 'uuid';
import { IPFS } from 'ipfs-core-types';
import { QueryStoreInitializationOptions } from '@dao-xyz/orbit-db-query-store';
import { Contract } from '@dao-xyz/peerbit-contract';

@variant(0)
export class AccessStore extends Contract {

    @field({ type: BinaryDocumentStore })
    access: BinaryDocumentStore<AccessData>;

    @field({ type: RelationContract })
    identityGraphController: RelationContract;

    @field({ type: TrustedNetwork })
    trustedNetwork: TrustedNetwork

    constructor(opts?: {
        name?: string;
        rootTrust?: PublicSignKey,
        trustedNetwork?: TrustedNetwork
    }) {
        super(opts);
        if (opts) {
            if (!opts.trustedNetwork && !opts.rootTrust) {
                throw new Error("Expecting either TrustedNetwork or rootTrust")
            }
            this.access = new BinaryDocumentStore({
                indexBy: 'id',
                objectType: AccessData.name,
            })

            this.trustedNetwork ? opts.trustedNetwork : new TrustedNetwork({
                name: (opts.name || uuid()) + "_region",
                rootTrust: opts.rootTrust as PublicSignKey
            })
            this.identityGraphController = new RelationContract({ name: 'relation', });
        }
    }



    // allow anyone write to the ACL db, but assume entry is invalid until a verifier verifies
    // can append will be anyone who has peformed some proof of work

    // or 

    // custom can append

    async canRead(s: SignatureWithKey | undefined): Promise<boolean> {
        // TODO, improve, caching etc

        if (!s) {
            return false;
        }

        // Else check whether its trusted by this access controller
        const canReadCheck = async (key: PublicSignKey) => {
            for (const value of Object.values(this.access._index._index)) {
                const access = value.value;
                if (access instanceof Access) {
                    if (access.accessTypes.find((x) => x === AccessType.Any || x === AccessType.Read) !== undefined) {
                        // check condition
                        if (await access.accessCondition.allowed(key)) {
                            return true;
                        }
                        continue;
                    }
                }
            }
        }

        if (await canReadCheck(s.publicKey)) {
            return true;
        }
        for await (const trustedByKey of getPathGenerator(s.publicKey, this.identityGraphController.relationGraph, getFromByTo)) {
            if (await canReadCheck(trustedByKey.from)) {
                return true;
            }
        }
        return false;
    }

    async canAppend(payload: MaybeEncrypted<Payload<any>>, key: MaybeEncrypted<SignatureWithKey>): Promise<boolean> {
        // TODO, improve, caching etc

        // Else check whether its trusted by this access controller
        const canWriteCheck = async (key: PublicSignKey) => {
            for (const value of Object.values(this.access._index._index)) {
                const access = value.value
                if (access instanceof Access) {
                    if (access.accessTypes.find((x) => x === AccessType.Any || x === AccessType.Write) !== undefined) {
                        // check condition
                        if (await access.accessCondition.allowed(key)) {
                            return true;
                        }
                        continue;
                    }
                }

            }
        }
        const signature = key.decrypted.getValue(SignatureWithKey)
        if (await canWriteCheck(signature.publicKey)) {
            return true;
        }
        for await (const trustedByKey of getPathGenerator(signature.publicKey, this.identityGraphController.relationGraph, getFromByTo)) {
            if (await canWriteCheck(trustedByKey.from)) {
                return true;
            }
        }
        return false;
    }


    async init(ipfs: IPFS, identity: Identity, options: QueryStoreInitializationOptions<Operation<Access>>): Promise<this> {
        this.access._clazz = AccessData;

        const store = await options.saveOrResolve(ipfs, this);
        if (store !== this) {
            return store as this;
        }

        /* await this.access.accessController.init(ipfs, publicKey, sign, options); */
        await this.identityGraphController.init(ipfs, identity, { ...options, canRead: this.canRead.bind(this), canAppend: this.canAppend.bind(this) });
        await this.access.init(ipfs, identity, { ...options, canRead: this.canRead.bind(this), canAppend: this.canAppend.bind(this) })
        await super.init(ipfs, identity, options);
        return this;
    }
}