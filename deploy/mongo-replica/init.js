const admin = db.getSiblingDB("admin");
if (!admin.auth(process.env.MONGO_ROOT_USERNAME, process.env.MONGO_ROOT_PASSWORD)) {
  throw new Error("MongoDB authentication failed");
}

const expected = { _id: "rs0", members: [{ _id: 0, host: "database:27017" }] };
let status;
try {
  status = admin.runCommand({ replSetGetStatus: 1 });
} catch (error) {
  if (error.code !== 94) throw error;
  status = { ok: 0, code: error.code };
}
if (status.ok !== 1 && status.code === 94) {
  const result = admin.runCommand({ replSetInitiate: expected });
  if (result.ok !== 1) throw new Error(`Replica set initialization failed: ${result.errmsg}`);
} else if (status.ok !== 1) {
  throw new Error(`Replica set status failed: ${status.errmsg}`);
}

const config = admin.runCommand({ replSetGetConfig: 1 });
if (config.ok !== 1 || config.config._id !== expected._id
    || config.config.members.length !== 1 || config.config.members[0]._id !== 0
    || config.config.members[0].host !== expected.members[0].host) {
  throw new Error("Unexpected replica set configuration; manual review required");
}

for (let i = 0; i < 120; i++) {
  if (admin.runCommand({ hello: 1 }).isWritablePrimary) {
    print("Replica set is ready");
    quit(0);
  }
  sleep(1000);
}
throw new Error("Replica set did not elect a primary");
