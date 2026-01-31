import { MongoClient } from "mongodb";

let client;
let clientPromise;

const uri = process.env.MONGO_URI;

if (!uri) throw new Error("Please add your MONGO_URI to environment variables");

if (process.env.NODE_ENV === "development") {
  // In dev, use a global variable to preserve the connection between hot reloads
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // In prod, create a new client
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;
