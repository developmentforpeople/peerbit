import { Session } from "@dao-xyz/peerbit-test-utils";
import { createTestDomain, startCertbot } from "../domain";
import path from "path";
import { Peerbit } from "@dao-xyz/peerbit";
import http from "http";
import { startServer } from "../api";
import dotenv from "dotenv";
import { createRecord } from "../aws";
import { v4 as uuid } from "uuid";

dotenv.config();

describe("ssl", () => {
    let session: Session, peer: Peerbit, server: http.Server;

    beforeAll(async () => {
        session = await Session.connected(1);
        peer = await Peerbit.create(session.peers[0].ipfs, {
            directory: "./peerbit/" + +new Date(),
        });
        server = await startServer(peer, 12345);
    });

    afterAll(async () => {
        await session.stop();
    });
    it("_", () => {});
    /* These test are flaky, or have side effects, and should not be running in ci yet
    it("certbot", async () => {
        const { exec } = await import("child_process");
        const containerName = "nginx-certbot-" + +new Date();
        const domain = await createTestDomain();
        await startCertbot(
            domain,
            "marcus@dao.xyz",
            path.join(__filename, "../tmp/config"),
            false,
            containerName
        );
        expect(domain.length > 0).toBeTrue();
        const exist =
            (await new Promise((resolve, reject) => {
                exec(
                    "docker ps --format '{{.Names}}' | egrep '^" +
                        containerName +
                        "$'",
                    (error, stdout, stderr) => {
                        resolve(stdout.trimEnd());
                        if (error || stderr) {
                            reject("Failed to check docker container exist");
                        }
                    }
                );
            })) === containerName;
        expect(exist).toBeTrue();
        await new Promise((resolve, reject) => {
            exec(
                "docker container stop " + containerName,
                (error, stdout, stderr) => {
                    resolve(stdout.trimEnd());
                    if (error || stderr) {
                        reject("Failed to check docker container exist");
                    }
                }
            );
        });
    });
 
    it("can create aws record", async () => {
        const ak = process.env.TEST_AWS_ACCESS_KEY_ID;
        const sk = process.env.TEST_AWS_SECREY_ACCESS_KEY;
        const subdomain = uuid();
        await createRecord({
            domain: subdomain + ".peerchecker.com",
            hostedZoneId: "Z0762538EEV3HRTQOXY3",
            credentials:
                ak && sk
                    ? {
                          accessKeyId: ak,
                          secretAccessKey: sk,
                      }
                    : undefined,
        });
    }); */
});