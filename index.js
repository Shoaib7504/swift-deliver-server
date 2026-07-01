const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;
const dns = require("dns");

// Change DNS
dns.setServers(["1.1.1.1", "8.8.8.8"]);
//middle ware
app.use(cors());
app.use(express.json());
// Mongodb Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qoz91xh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    const db = client.db('swift_deliver_db');
    const parcelsCollection = db.collection('parcels')
    const usersCollection = db.collection('users');

    // Users api
    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null })
      }
      const result = await usersCollection.insertOne(user);
      res.send(result)
    })

    //Parcels api
    app.get('/parcels', async (req, res) => {
      let query = {}
      const email = req.query.email;
      // parcles?email=''&
      if (email) {
        query.email = email;
      }

      const option = { sort: { createdAt: -1 } }
      const cursor = parcelsCollection.find(query, option);
      const result = await cursor.toArray()
      res.send(result)
    })

    // Post parcels
    app.post('/parcels', async (req, res) => {
      const parcel = req.body
      const result = await parcelsCollection.insertOne(parcel)
      res.send(result)
    })
    // Delete Parcels Orders
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query  = { _id: new ObjectId(id) }
      const result = await parcelsCollection.deleteOne(query)
      res.send(result)
    })

    // get parcel details api
    app.get('/parcels/:id', async(req,res)=>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollection.findOne(query)
      res.send(result)
    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Zap Shift Server is running');
});

app.listen(port, () => {
  console.log(`Zap Shift Server is running on port ${port}`);
});