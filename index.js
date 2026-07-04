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

// verify User
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require("./firebase-admin-sdk.json");

initializeApp({
  credential: cert(serviceAccount),
});

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({
      message: "Unauthorized access",
    });
  }

  try {
    const token = authHeader.split(" ")[1];

    const decodedToken = await getAuth().verifyIdToken(token);

    req.decoded = decodedToken;

    next();
  } catch (error) {
    console.error(error);

    return res.status(401).send({
      message: "Unauthorized access",
    });
  }
};

module.exports = verifyFBToken;



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
    const riderCollection = db.collection('riders')


    // rider related apis
    app.get("/riders", verifyFBToken, async (req, res) => {
      const options = {
        sort: { createdAt: -1 },
      };
      const result = await riderCollection.find({}, options).toArray();

      res.send(result);
    });
    // patch rider approved status
    app.patch('/rider/:id/approve', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          status: "approved",
        }
      }
      const result = await riderCollection.updateOne(query, updateDoc)
      res.send(result)
    })
    // patch rider rejected status
    app.patch('/rider/:id/reject', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          status: "rejected",
        }
      }
      const result = await riderCollection.updateOne(query, updateDoc)
      res.send(result)
    })
    // post a rider
    app.post('/rider', verifyFBToken, async (req, res) => {
      const query = { email: req.body.email };
      const existingRider = await riderCollection.findOne(query)
      if (existingRider) {
        return res.send({ message: 'Rider already exists', insertedId: null })
      }
      const rider = req.body;
      const result = await riderCollection.insertOne(rider);
      res.send(result);
    })

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
    // get Users data
    app.get('/users', verifyFBToken, async (req, res) => {
      const result = await usersCollection.find().toArray()
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
    app.post('/parcels', verifyFBToken, async (req, res) => {
      const parcel = req.body
      const result = await parcelsCollection.insertOne(parcel)
      res.send(result)
    })
    // Delete Parcels Orders
    app.delete('/parcels/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollection.deleteOne(query)
      res.send(result)
    })

    // get parcel details api
    app.get('/parcels/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollection.findOne(query)
      res.send(result)
    })

    // Create checkout session
    app.post('/create-checkout-session', verifyFBToken, async (req, res) => {
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
      const generateTrackingId = () => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `SWIFT-${timestamp}${random}`;
      };
      if (session.payment_status == 'paid') {
        const parcelId = session.metadata.parcelId;
        const query = { _id: new ObjectId(parcelId) }
        const updateDoc = {
          $set: {
            status: "paid",
            deliveryStatus: "pending",
            tracking_no: generateTrackingId(),
            transactionId: session.payment_intent,
            paidAt: new Date(),
          }
        }
        const updateResult = await parcelsCollection.updateOne(query, updateDoc);
        res.send({ success: true, message: "Payment success", updateResult })
      } else {
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