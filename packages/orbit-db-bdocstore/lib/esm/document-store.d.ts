/// <reference types="orbit-db" />
import Store from 'orbit-db-store';
import { DocumentIndex } from './document-index';
import { IPFS as IPFSInstance } from 'ipfs';
import { Identity } from 'orbit-db-identity-provider';
import { Constructor } from '@dao-xyz/borsh';
import { QueryRequestV0, QueryResponse } from './query';
export declare const BINARY_DOCUMENT_STORE_TYPE = "bdocstore";
export declare class BinaryDocumentStore<T> extends Store<T, DocumentIndex<T>> {
    _type: string;
    constructor(ipfs: IPFSInstance, id: Identity, dbname: string, options: IStoreOptions & {
        indexBy?: string;
        clazz: Constructor<T>;
    });
    get index(): DocumentIndex<T>;
    get(key: any, caseSensitive?: boolean): T[];
    query(mapper: ((doc: T) => boolean), options?: {
        fullOp?: boolean;
    }): T[] | {
        payload: Payload<T>;
    }[];
    queryAny(query: QueryRequestV0, clazz: Constructor<T>, responseHandler: (response: QueryResponse<T>) => void, maxAggregationTime?: number): Promise<void>;
    subscribeToQueries(): Promise<void>;
    get queryTopic(): string;
    batchPut(docs: T[], onProgressCallback: any): Promise<any>;
    put(doc: T, options?: {}): Promise<string>;
    putAll(docs: T[], options?: {}): Promise<string>;
    del(key: any, options?: {}): Promise<string>;
}
