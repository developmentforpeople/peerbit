import { ReplicationRangeIndexable } from "../src/replication.js";
import { Ed25519Keypair, Ed25519PublicKey } from "@peerbit/crypto";
import { getCoverSet, getDistance, getSamples } from "../src/ranges.js";
import { expect } from "chai";
import type { Index } from "@peerbit/indexer-interface";
import { create as createIndices } from "@peerbit/indexer-sqlite3";



// prettier-ignore
describe("ranges", () => {
    let peers: Index<ReplicationRangeIndexable>
    let a: Ed25519PublicKey, b: Ed25519PublicKey, c: Ed25519PublicKey;

    let create = async (...rects: ReplicationRangeIndexable[]) => {
        const indices = (await createIndices())
        await indices.start()
        const index = await indices.init({ schema: ReplicationRangeIndexable })
        for (const rect of rects) {
            await index.put(rect)
        }
        peers = index
    }
    before(async () => {
        a = (await Ed25519Keypair.create()).publicKey;
        b = (await Ed25519Keypair.create()).publicKey;
        c = (await Ed25519Keypair.create()).publicKey;
    })
    beforeEach(() => {
        peers = undefined!;
    })

    describe('getCover', () => {

        const rotations = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
        rotations.forEach((rotation) => {
            describe('rotation: ' + String(rotation), () => {

                describe('underflow', () => {
                    it('includes all', async () => {
                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.1, offset: (0 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.1, offset: (0.333 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.1, offset: (0.666 + rotation) % 1, timestamp: 0n })
                        );

                        // we try to cover 0.5 starting from a
                        // this should mean that we would want a and b, because c is not mature enough, even though it would cover a wider set
                        expect([...await getCoverSet(1, peers, 1e5, a)]).to.have.members([a.hashcode(), b.hashcode(), c.hashcode()])

                    })
                })

                describe("overflow", () => {
                    it("local first", async () => {
                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 1, offset: (0 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 1, offset: (0.333 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 1, offset: (0.666 + rotation) % 1, timestamp: 0n }))

                        // we try to cover 0.5 starting from a
                        // this should mean that we would want a and b, because c is not mature enough, even though it would cover a wider set
                        expect([...await getCoverSet(1, peers, 1e5, a)]).to.have.members([a.hashcode()])
                    })
                })

                describe("unmature", () => {

                    it('all unmature', async () => {
                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.34, offset: (0 + rotation) % 1, timestamp: BigInt(+new Date) }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.34, offset: (0.333 + rotation) % 1, timestamp: BigInt(+new Date) }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.34, offset: (0.666 + rotation) % 1, timestamp: BigInt(+new Date) })
                        );

                        // we try to cover 0.5 starting from a
                        // this should mean that we would want a and b, because c is not mature enough, even though it would cover a wider set
                        expect([...await getCoverSet(1, peers, 1e5, a)]).to.have.members([a.hashcode(), b.hashcode(), c.hashcode()])

                    })

                    it('two unmature', async () => {
                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.34, offset: (0 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.34, offset: (0.333 + rotation) % 1, timestamp: BigInt(+new Date) }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.34, offset: (0.666 + rotation) % 1, timestamp: BigInt(+new Date) })
                        );


                        // should not be included. TODO is this always expected behaviour?
                        expect([...await getCoverSet(1, peers, 1e5, a)]).to.have.members([a.hashcode()])

                    })
                })
                describe("skip", () => {
                    it('next', async () => {


                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.34, offset: (0 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.41, offset: (0.1 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.5, offset: (0.3 + rotation) % 1, timestamp: BigInt(+new Date) })
                        );

                        // we try to cover 0.5 starting from a
                        // this should mean that we would want a and b, because c is not mature enough, even though it would cover a wider set
                        expect([...await getCoverSet(0.5, peers, 1e5, a)]).to.have.members([a.hashcode(), b.hashcode()])
                    })
                    it('between', async () => {


                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.34, offset: (0 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.5, offset: (0.2 + rotation) % 1, timestamp: BigInt(+new Date) }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.34, offset: (0.3 + rotation) % 1, timestamp: 0n })
                        );


                        // we try to cover 0.5 starting from a
                        // this should mean that we would want a and b, because c is not mature enough, even though it would cover a wider set
                        expect([...await getCoverSet(0.5, peers, 1e5, a)]).to.have.members([a.hashcode(), b.hashcode()])

                    })
                })

                describe("boundary", () => {

                    it('exact', async () => {

                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.5, offset: (0.2 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.5, offset: (0.5 + rotation) % 1, timestamp: 0n })
                        );

                        // because of rounding errors, a cover width of 0.5 might yield unecessary results
                        expect([...await getCoverSet(0.499, peers, 0, a)]).to.have.members([a.hashcode()])
                    })

                    it('after', async () => {

                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.1, offset: (0.21 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.5, offset: (0.5 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.1, offset: (0.81 + rotation) % 1, timestamp: 0n })
                        );

                        expect([...await getCoverSet(0.6, peers, 0, b)]).to.have.members([b.hashcode()])
                    })

                    it('skip matured', async () => {
                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.1, offset: (0.2 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.5, offset: (0.5 + rotation) % 1, timestamp: BigInt(+new Date) }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.1, offset: (0.81 + rotation) % 1, timestamp: 0n })
                        );
                        // starting from b, we need both a and c since b is not mature to cover the width
                        expect([...await getCoverSet(0.5, peers, 1e5, a)]).to.have.members([a.hashcode(), c.hashcode()])
                    })

                    it('include start node identity', async () => {
                        await create(
                            new ReplicationRangeIndexable({ publicKey: a, length: 0.1, offset: (0.2 + rotation) % 1, timestamp: 0n }),
                            new ReplicationRangeIndexable({ publicKey: b, length: 0.5, offset: (0.5 + rotation) % 1, timestamp: BigInt(+new Date) }),
                            new ReplicationRangeIndexable({ publicKey: c, length: 0.1, offset: (0.81 + rotation) % 1, timestamp: 0n })
                        );
                        // starting from b, we need both a and c since b is not mature to cover the width
                        expect([...await getCoverSet(0.5, peers, 1e5, b)]).to.have.members([a.hashcode(), b.hashcode(), c.hashcode()])
                    })
                })
            })

        })
    })

    describe("getSamples", () => {
        const rotations = [0, 0.333, 0.5, 0.8]
        rotations.forEach((rotation) => {
            describe('samples correctly: ' + rotation, () => {
                it("1 and less than 1", async () => {
                    await create(
                        new ReplicationRangeIndexable({ publicKey: a, length: 0.2625, offset: (0.367 + rotation) % 1, timestamp: 0n }),
                        new ReplicationRangeIndexable({ publicKey: b, length: 1, offset: (0.847 + rotation) % 1, timestamp: 0n }))
                    expect(await getSamples(0.78, peers, 2, 0)).to.have.length(2)
                })

                it("1 sample but overlapping yield two matches", async () => {
                    await create(
                        new ReplicationRangeIndexable({ publicKey: a, length: 1, offset: (0.367 + rotation) % 1, timestamp: 0n }),
                        new ReplicationRangeIndexable({ publicKey: b, length: 1, offset: (0.847 + rotation) % 1, timestamp: 0n }))
                    expect(await getSamples(0.78, peers, 1, 0)).to.have.length(2)
                })
            })

        })



        it("factor 0 ", async () => {
            await create(
                new ReplicationRangeIndexable({ publicKey: a, length: 0, offset: (0.367) % 1, timestamp: 0n }),
                new ReplicationRangeIndexable({ publicKey: b, length: 1, offset: (0.567) % 1, timestamp: 0n }),
                new ReplicationRangeIndexable({ publicKey: c, length: 1, offset: (0.847) % 1, timestamp: 0n })
            );
            expect(await getSamples(0.3701, peers, 2, 0)).to.have.members([b, c].map(x => x.hashcode()))
        })


        it("factor 0 with 3 peers factor 1", async () => {
            await create(
                new ReplicationRangeIndexable({ publicKey: a, length: 1, offset: 0.145, timestamp: 0n }),
                new ReplicationRangeIndexable({ publicKey: b, length: 0, offset: 0.367, timestamp: 0n }),
                new ReplicationRangeIndexable({ publicKey: c, length: 1, offset: 0.8473, timestamp: 0n })
            );
            expect(await getSamples(0.937, peers, 2, 0)).to.have.members([a, c].map(x => x.hashcode()))
        })

        it("factor 0 with 3 peers short", async () => {
            await create(
                new ReplicationRangeIndexable({ publicKey: a, length: 0.2, offset: 0.145, timestamp: 0n }),
                new ReplicationRangeIndexable({ publicKey: b, length: 0, offset: 0.367, timestamp: 0n }),
                new ReplicationRangeIndexable({ publicKey: c, length: 0.2, offset: 0.8473, timestamp: 0n })
            );
            expect(await getSamples(0.937, peers, 2, 0)).to.have.members([a, c].map(x => x.hashcode()))
        })

        rotations.forEach((rotation) => {

            it("evenly distributed: " + rotation, async () => {
                await create(
                    new ReplicationRangeIndexable({ publicKey: a, length: 0.2, offset: (0.2333 + rotation) % 1, timestamp: 0n }),
                    new ReplicationRangeIndexable({ publicKey: b, length: 0.2, offset: (0.56666 + rotation) % 1, timestamp: 0n }),
                    new ReplicationRangeIndexable({ publicKey: c, length: 0.2, offset: (0.9 + rotation) % 1, timestamp: 0n })
                );


                let ac = 0, bc = 0, cc = 0;
                let count = 1000;
                for (let i = 0; i < count; i++) {
                    const leaders = await getSamples(i / count, peers, 1, 0)
                    if (leaders.includes(a.hashcode())) { ac++; }
                    if (leaders.includes(b.hashcode())) { bc++; }
                    if (leaders.includes(c.hashcode())) { cc++; }
                }

                // check ac, bc and cc are all close to 1/3
                expect(ac / count).to.be.closeTo(1 / 3, 0.1)
                expect(bc / count).to.be.closeTo(1 / 3, 0.1)
                expect(cc / count).to.be.closeTo(1 / 3, 0.1)
            })
        })






        describe('maturity', () => {
            it("starting at unmatured", async () => {
                await create(
                    new ReplicationRangeIndexable({ publicKey: a, length: 0.333, offset: (0.333) % 1, timestamp: 0n }),
                    new ReplicationRangeIndexable({ publicKey: b, length: 0.333, offset: (0.666) % 1, timestamp: BigInt(+new Date) }),
                    new ReplicationRangeIndexable({ publicKey: c, length: 0.3333, offset: (0.999) % 1, timestamp: 0n }),
                );
                expect(await getSamples(0.7, peers, 2, 1e5)).to.have.members([a, b, c].map(x => x.hashcode()))
            })

            it("starting at matured", async () => {
                await create(
                    new ReplicationRangeIndexable({ publicKey: a, length: 0.333, offset: (0.333) % 1, timestamp: 0n }),
                    new ReplicationRangeIndexable({ publicKey: b, length: 0.333, offset: (0.666) % 1, timestamp: BigInt(+new Date) }),
                    new ReplicationRangeIndexable({ publicKey: c, length: 0.3333, offset: (0.999) % 1, timestamp: 0n })
                );
                // the offset jump will be 0.5 (a) and 0.5 + 0.5 = 1 which will intersect (c)
                expect(await getSamples(0.5, peers, 2, 1e5)).to.have.members([a, c].map(x => x.hashcode()))
            })

            it("starting at matured-2", async () => {
                await create(
                    new ReplicationRangeIndexable({ publicKey: a, length: 0.333, offset: (0.333) % 1, timestamp: 0n }),
                    new ReplicationRangeIndexable({ publicKey: b, length: 0.333, offset: (0.666) % 1, timestamp: BigInt(+new Date) }),
                    new ReplicationRangeIndexable({ publicKey: c, length: 0.3333, offset: (0.999) % 1, timestamp: 0n })
                );
                // the offset jump will be 0.2 (a) and 0.2 + 0.5 = 0.7 which will intersect (b) (unmatured)
                expect(await getSamples(0, peers, 2, 1e5)).to.have.members([a, c].map(x => x.hashcode()))
            })
        })
    })

    describe("getDistance", () => {

        describe('above', () => {
            it("immediate", () => {
                expect(getDistance(0.5, 0.4, 'above', 1)).to.be.closeTo(0.1, 0.0001)
            })

            it('wrap', () => {
                expect(getDistance(0.1, 0.9, 'above', 1)).to.be.closeTo(0.2, 0.0001)
            })
        })

        describe('below', () => {

            it("immediate", () => {
                expect(getDistance(0.5, 0.6, 'below', 1)).to.be.closeTo(0.1, 0.0001)
            })

            it('wrap', () => {
                expect(getDistance(0.9, 0.1, 'below', 1)).to.be.closeTo(0.2, 0.0001)
            })

        })

        describe('closest', () => {
            it('immediate', () => {
                expect(getDistance(0.5, 0.6, 'closest', 1)).to.be.closeTo(0.1, 0.0001)
            })

            it('wrap', () => {
                expect(getDistance(0.9, 0.1, 'closest', 1)).to.be.closeTo(0.2, 0.0001)
            })

            it('wrap 2', () => {
                expect(getDistance(0.1, 0.9, 'closest', 1)).to.be.closeTo(0.2, 0.0001)
            })
        })
    })
})
