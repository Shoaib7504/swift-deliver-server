const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;
const dns = require("dns");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollection.deleteOne(query)
      res.send(result)
    })

    // get parcel details api
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollection.findOne(query)
      res.send(result)
    })

    // Create checkout session
    app.post('/create-checkout-session', async (req, res) => {
      const parcelInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: Math.round(parcelInfo.price * 100),
              product_data: {
                name: parcelInfo.productName,
                description: parcelInfo.productDescription,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",

        success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?parcelId=${parcelInfo._id}&session_id={CHECKOUT_SESSION_ID}`,

        cancel_url: `${process.env.CLIENT_URL}/dashboard/payment-cancel`,

        metadata: {
          parcelId: parcelInfo._id,
          userEmail: parcelInfo.email,
          sender: parcelInfo.senderServiceCenter,
          receiver: parcelInfo.receiverServiceCenter,
          deliveryCost: parcelInfo.price.toString(), // metadata values should be strings
        },
      });
      res.json({ url: session.url })
      // console.log(session.url);
    })
    // 
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId)
     if(session.payment_status=='paid'){
        const email = session.metadata.userEmail;
      const parcelId = session.metadata.parcelId;
      const deliveryCost = session.metadata.deliveryCost;
      const query = { _id: new ObjectId(parcelId) }
      const updateDoc={
        $set: {
         status: "paid",
          deliveryStatus: "pending",
         tracking_no:session. payment_intent
        }
      }
      const updateResult = await parcelsCollection.updateOne(query, updateDoc);
      res.send({ success: true, message: "Payment success", updateResult })
     }else{
      res.send({ message: "Payment failed" })
     }
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