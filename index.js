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

    // verifyAdmin middleware (inside run() to access collections)
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email }
      const user = await usersCollection.findOne(query)
      const isAdmin = user?.role === 'admin'
      if (!isAdmin) {
        return res.status(403).send({ message: 'Forbidden' })
      }
      next();
    }

    // verifyRider middleware (inside run() to access collections)
    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const result = await usersCollection.findOne(query)
      const isRider = result?.role === 'rider'
      if (!isRider) {
        return res.status(403).send({ message: 'Forbidden' })
      }
      next();
    }


    // Get all riders (admin only)
    app.get("/riders", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const options = {
          sort: { createdAt: -1 },
        };
        const result = await riderCollection.find({}, options).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Approve rider (admin only)
    app.patch('/rider/:id/approve', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { email } = req.body;
        const query = { _id: new ObjectId(id) }
        const updateDoc = {
          $set: {
            status: "approved",
          }
        }

        // Update user role
        const userResult = await usersCollection.updateOne(
          { email },
          {
            $set: {
              role: "rider",
            },
          }
        );
        const result = await riderCollection.updateOne(query, updateDoc)
        res.send({ result, userResult })
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Reject rider (admin only)
    app.patch('/rider/:id/reject', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { email } = req.body;
        const query = { _id: new ObjectId(id) }
        const updateDoc = {
          $set: {
            status: "rejected",
          }
        }

        // Change role back to user
        const userResult = await usersCollection.updateOne(
          { email },
          {
            $set: {
              role: "user",
            },
          }
        );
        const result = await riderCollection.updateOne(query, updateDoc)
        res.send({ result, userResult })
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Post a rider application
    app.post('/rider', verifyFBToken, async (req, res) => {
      try {
        const query = { email: req.body.email };
        const existingRider = await riderCollection.findOne(query)
        if (existingRider) {
          return res.send({ message: 'Rider already exists', insertedId: null })
        }
        const rider = req.body;
        const result = await riderCollection.insertOne(rider);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Create user
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
        const query = { email: user.email }
        const existingUser = await usersCollection.findOne(query);
        if (existingUser) {
          return res.send({ message: "User already exists", insertedId: null })
        }
        const result = await usersCollection.insertOne(user);
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Get all users (admin only)
    app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const result = await usersCollection.find().toArray()
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Check if user is an admin (must be before /users/:email)
    app.get('/users/admin/:email', verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: 'Forbidden' })
        }
        const user = await usersCollection.findOne({ email });
        const isAdmin = user?.role === 'admin';
        res.send({ isAdmin });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Check if user is a rider (must be before /users/:email)
    app.get('/users/rider/:email', verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: 'Forbidden' })
        }
        const user = await usersCollection.findOne({ email });
        const isRider = user?.role === 'rider';
        res.send({ isRider });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Make user an admin (admin only)
    app.patch('/users/admin/:email', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const email = req.params.email;
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role: 'admin' } }
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Get single user (must be after /users/admin/:email and /users/rider/:email)
    app.get("/users/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        res.send(user);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Get parcels (with optional email filter)
    app.get('/parcels', verifyFBToken, async (req, res) => {
      try {
        let query = {}
        const email = req.query.email;
        if (email) {
          query.email = email;
        }

        const option = { sort: { createdAt: -1 } }
        const cursor = parcelsCollection.find(query, option);
        const result = await cursor.toArray()
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Post parcel
    app.post('/parcels', verifyFBToken, async (req, res) => {
      try {
        const parcel = req.body
        const result = await parcelsCollection.insertOne(parcel)
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Get parcels assigned to a rider (must be before /parcels/:id)
    app.get('/parcels/rider/:email', verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const option = { sort: { assignedAt: -1 } }
        const result = await parcelsCollection.find({ riderEmail: email }, option).toArray()
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Get parcel details
    app.get('/parcels/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) }
        const result = await parcelsCollection.findOne(query)
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Update parcel info (before payment only)
    app.patch('/parcels/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) }
        const parcel = await parcelsCollection.findOne(query);
        if (parcel?.status === 'paid') {
          return res.status(400).send({ message: 'Cannot update a paid parcel' })
        }
        const updateDoc = { $set: { ...req.body, updatedAt: new Date() } }
        const result = await parcelsCollection.updateOne(query, updateDoc)
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Delete parcel
    app.delete('/parcels/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) }
        const result = await parcelsCollection.deleteOne(query)
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Assign rider to parcel (admin only)
    app.patch('/parcels/:id/assign-rider', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { riderId, riderEmail, riderName } = req.body;
        const query = { _id: new ObjectId(id) }
        const updateDoc = {
          $set: {
            riderId,
            riderEmail,
            riderName,
            deliveryStatus: 'assigned',
            assignedAt: new Date(),
          }
        }
        const result = await parcelsCollection.updateOne(query, updateDoc)
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Update delivery status (rider only)
    app.patch('/parcels/:id/delivery-status', verifyFBToken, verifyRider, async (req, res) => {
      try {
        const id = req.params.id;
        const { deliveryStatus } = req.body;
        const validStatuses = ['picked_up', 'in_transit', 'delivered'];
        if (!validStatuses.includes(deliveryStatus)) {
          return res.status(400).send({
            message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
          })
        }
        const query = { _id: new ObjectId(id) }
        const updateFields = {
          deliveryStatus,
          [`${deliveryStatus}At`]: new Date(),
        }
        const updateDoc = { $set: updateFields }
        const result = await parcelsCollection.updateOne(query, updateDoc)
        res.send(result)
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Create checkout session
    app.post('/create-checkout-session', verifyFBToken, async (req, res) => {
      try {
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
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })

    // Payment success callback
    app.patch('/payment-success', async (req, res) => {
      try {
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
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    })


    //  ADMIN STATS API
    app.get('/admin-stats', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalRiders = await riderCollection.countDocuments({ status: 'approved' });
        const totalParcels = await parcelsCollection.countDocuments();
        const deliveredParcels = await parcelsCollection.countDocuments({ deliveryStatus: 'delivered' });
        const pendingParcels = await parcelsCollection.countDocuments({ deliveryStatus: 'pending' });

        // Calculate total revenue from paid parcels
        const revenueResult = await parcelsCollection.aggregate([
          { $match: { status: 'paid' } },
          { $group: { _id: null, totalRevenue: { $sum: { $toDouble: '$price' } } } }
        ]).toArray();
        const totalRevenue = revenueResult[0]?.totalRevenue || 0;

        res.send({
          totalUsers,
          totalRiders,
          totalParcels,
          deliveredParcels,
          pendingParcels,
          totalRevenue,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
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