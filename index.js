const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
if (!stripe) {
  console.warn("WARNING: STRIPE_SECRET_KEY is not set. Stripe functionality will be disabled.");
}

// ---------- Middleware ----------
const allowedOrigins = [
  "https://swift-deliver-ten.vercel.app",
  "http://localhost:5173",
  
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error("CORS blocked origin:", origin);
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// ---------- Firebase Admin ----------
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    let rawString = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    if (!rawString.startsWith('{')) {
      rawString = Buffer.from(rawString, 'base64').toString('utf8');
    }
    serviceAccount = JSON.parse(rawString);
  } catch (error) {
    console.error("ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT env variable. Make sure it is valid JSON or Base64.", error);
  }
} else {
  console.warn("WARNING: FIREBASE_SERVICE_ACCOUNT env variable is not set.");
}

if (serviceAccount) {
  initializeApp({
    credential: cert(serviceAccount),
  });
} else {
  console.warn("WARNING: Firebase Admin could not be initialized because serviceAccount is missing or invalid.");
}

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const token = authHeader.split(" ")[1];
    if (!serviceAccount) {
      console.error("Firebase Admin SDK was not initialized. Check your FIREBASE_SERVICE_ACCOUNT environment variable.");
      return res.status(500).send({ message: "Firebase Authentication is unconfigured on the server." });
    }
    const decodedToken = await getAuth().verifyIdToken(token);
    req.decoded = decodedToken;
    next();
  } catch (error) {
    console.error(error);
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

// ---------- MongoDB (serverless-safe cached connection) ----------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qoz91xh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, parcelsCollection, usersCollection, riderCollection;
let clientPromise = null;

function connectDB() {
  if (!clientPromise) {
    clientPromise = client.connect().then((connectedClient) => {
      db = connectedClient.db('swift_deliver_db');
      parcelsCollection = db.collection('parcels');
      usersCollection = db.collection('users');
      riderCollection = db.collection('riders');
      console.log("Connected to MongoDB!");
      return connectedClient;
    }).catch((err) => {
      // Reset so the next request can retry instead of being stuck forever
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

// Ensure DB is connected before any route handler runs.
// This works correctly both locally (connects once) and on Vercel
// (connects on cold start, reused on warm invocations).
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB connection error:", err);
    res.status(500).send({ message: "Database connection failed" });
  }
});

// ---------- Role-check middlewares ----------
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });
  const isAdmin = user?.role === 'admin';
  if (!isAdmin) {
    return res.status(403).send({ message: 'Forbidden' });
  }
  next();
};

const verifyRider = async (req, res, next) => {
  const email = req.decoded.email;
  const result = await usersCollection.findOne({ email });
  const isRider = result?.role === 'rider';
  if (!isRider) {
    return res.status(403).send({ message: 'Forbidden' });
  }
  next();
};

// ---------- Root ----------
app.get('/', (req, res) => {
  res.send('Zap Shift Server is running');
});

// ---------- Riders ----------

// Get all riders (admin only)
app.get("/riders", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const options = { sort: { createdAt: -1 } };
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
    const query = { _id: new ObjectId(id) };
    const updateDoc = { $set: { status: "approved" } };

    const userResult = await usersCollection.updateOne(
      { email },
      { $set: { role: "rider" } }
    );
    const result = await riderCollection.updateOne(query, updateDoc);
    res.send({ result, userResult });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Reject rider (admin only)
app.patch('/rider/:id/reject', verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body;
    const query = { _id: new ObjectId(id) };
    const updateDoc = { $set: { status: "rejected" } };

    const userResult = await usersCollection.updateOne(
      { email },
      { $set: { role: "user" } }
    );
    const result = await riderCollection.updateOne(query, updateDoc);
    res.send({ result, userResult });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Post a rider application
app.post('/rider', verifyFBToken, async (req, res) => {
  try {
    const query = { email: req.body.email };
    const existingRider = await riderCollection.findOne(query);
    if (existingRider) {
      return res.send({ message: 'Rider already exists', insertedId: null });
    }
    const rider = req.body;
    const result = await riderCollection.insertOne(rider);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// ---------- Users ----------

// Create user
app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    const query = { email: user.email };
    const existingUser = await usersCollection.findOne(query);
    if (existingUser) {
      return res.send({ message: "User already exists", insertedId: null });
    }
    const result = await usersCollection.insertOne(user);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Get all users (admin only)
app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const result = await usersCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Check if user is an admin (must be before /users/:email)
app.get('/users/admin/:email', verifyFBToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: 'Forbidden' });
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
      return res.status(403).send({ message: 'Forbidden' });
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

// ---------- Parcels ----------

// Get parcels (with optional email filter)
app.get('/parcels', verifyFBToken, async (req, res) => {
  try {
    let query = {};
    const email = req.query.email;
    if (email) {
      query.email = email;
    }
    const option = { sort: { createdAt: -1 } };
    const cursor = parcelsCollection.find(query, option);
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Post parcel
app.post('/parcels', verifyFBToken, async (req, res) => {
  try {
    const parcel = req.body;
    const result = await parcelsCollection.insertOne(parcel);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Get parcels assigned to a rider (must be before /parcels/:id)
app.get('/parcels/rider/:email', verifyFBToken, async (req, res) => {
  try {
    const email = req.params.email;
    const option = { sort: { assignedAt: -1 } };
    const result = await parcelsCollection.find({ riderEmail: email }, option).toArray();
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Get parcel details
app.get('/parcels/:id', verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await parcelsCollection.findOne(query);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Update parcel info (before payment only)
app.patch('/parcels/:id', verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const parcel = await parcelsCollection.findOne(query);
    if (parcel?.status === 'paid') {
      return res.status(400).send({ message: 'Cannot update a paid parcel' });
    }
    const updateDoc = { $set: { ...req.body, updatedAt: new Date() } };
    const result = await parcelsCollection.updateOne(query, updateDoc);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Delete parcel
app.delete('/parcels/:id', verifyFBToken, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await parcelsCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Assign rider to parcel (admin only)
app.patch('/parcels/:id/assign-rider', verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { riderId, riderEmail, riderName } = req.body;
    const query = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        riderId,
        riderEmail,
        riderName,
        deliveryStatus: 'assigned',
        assignedAt: new Date(),
      }
    };
    const result = await parcelsCollection.updateOne(query, updateDoc);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Update delivery status (rider only)
app.patch('/parcels/:id/delivery-status', verifyFBToken, verifyRider, async (req, res) => {
  try {
    const id = req.params.id;
    const { deliveryStatus } = req.body;
    const validStatuses = ['picked_up', 'in_transit', 'delivered'];
    if (!validStatuses.includes(deliveryStatus)) {
      return res.status(400).send({
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    const query = { _id: new ObjectId(id) };
    const updateFields = {
      deliveryStatus,
      [`${deliveryStatus}At`]: new Date(),
    };
    const updateDoc = { $set: updateFields };
    const result = await parcelsCollection.updateOne(query, updateDoc);
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// ---------- Payments ----------

// Create checkout session
app.post('/create-checkout-session', verifyFBToken, async (req, res) => {
  try {
    const parcelInfo = req.body;
    if (!stripe) {
      console.error("Stripe is not configured on this server.");
      return res.status(500).send({ message: "Payment service is currently unavailable." });
    }
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
        deliveryCost: parcelInfo.price.toString(),
      },
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Payment success callback
app.patch('/payment-success', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!stripe) {
      console.error("Stripe is not configured on this server.");
      return res.status(500).send({ message: "Payment service is currently unavailable." });
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const generateTrackingId = () => {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      return `SWIFT-${timestamp}${random}`;
    };

    if (session.payment_status == 'paid') {
      const parcelId = session.metadata.parcelId;
      const query = { _id: new ObjectId(parcelId) };
      const updateDoc = {
        $set: {
          status: "paid",
          deliveryStatus: "pending",
          tracking_no: generateTrackingId(),
          transactionId: session.payment_intent,
          paidAt: new Date(),
        }
      };
      const updateResult = await parcelsCollection.updateOne(query, updateDoc);
      res.send({ success: true, message: "Payment success", updateResult });
    } else {
      res.send({ message: "Payment failed" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// ---------- Admin stats ----------
app.get('/admin-stats', verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalRiders = await riderCollection.countDocuments({ status: 'approved' });
    const totalParcels = await parcelsCollection.countDocuments();
    const deliveredParcels = await parcelsCollection.countDocuments({ deliveryStatus: 'delivered' });
    const pendingParcels = await parcelsCollection.countDocuments({ deliveryStatus: 'pending' });

    const revenueResult = await parcelsCollection.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, totalRevenue: { $sum: { $toDouble: '$deliveryCost' } } } }
    ]).toArray();
    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    const payoutsResult = await parcelsCollection.aggregate([
      { $match: { status: 'paid', deliveryStatus: 'delivered' } },
      { $group: { _id: null, totalPayouts: { $sum: { $toDouble: '$deliveryCost' } } } }
    ]).toArray();
    const totalRiderPayouts = (payoutsResult[0]?.totalPayouts || 0) * 0.3;
    const adminNetProfit = totalRevenue - totalRiderPayouts;

    res.send({
      totalUsers,
      totalRiders,
      totalParcels,
      deliveredParcels,
      pendingParcels,
      totalRevenue,
      totalRiderPayouts,
      adminNetProfit,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// ---------- 404 handler ----------
app.use((req, res) => {
  res.status(404).send({ message: "Route not found" });
});

// ---------- Global error handler (catches anything unhandled) ----------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).send({ message: "Internal server error" });
});


if (!process.env.VERCEL) {
  connectDB()
    .then(() => {
      app.listen(port, () => {
        console.log(`Zap Shift Server is running on port ${port}`);
      });
    })
    .catch((err) => {
      console.error("Failed to connect to MongoDB:", err);
      process.exit(1);
    });
}

module.exports = app;