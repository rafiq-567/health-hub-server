const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


// load env variables from .env files
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;



const allowedOrigins = [
  'http://localhost:5173', // local frontend
  'https://health-hub-7c64c.web.app', // deployed frontend
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};



app.use(cors(corsOptions));
app.use(express.json());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xukamdp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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
        // Connect the client to the server	(optional starting in v4.7)


        const db = client.db('healthHubDB');//database name
        const healthHubCollection = db.collection('healthHub') // collection
        const usersCollection = db.collection('users');
        const categoryCollection = db.collection("categories");
        const paymentCollection = db.collection('payments');
        const sliderCollection = db.collection('sliderItems');


        // In your server.js, modify the healthHub endpoint
        app.get('/healthHub', async (req, res) => {
            try {
                const { category } = req.query;
                const filter = category ? {
                    category: { $regex: new RegExp(category, 'i') }// Case-insensitive search

                } : {};

                const medicines = await healthHubCollection.find(filter).toArray();
                res.send(medicines);
            } catch (error) {
                console.error('Error fetching medicines:', error);
                res.status(500).send({ message: 'Failed to fetch medicines' });
            }
        });

        // create a new healthHub
        app.post('/healthHub', async (req, res) => {
            try {
                const newHealth = req.body;
                const result = await healthHubCollection.insertOne(newHealth);
                res.status(201).send(result);
            }
            catch (error) {
                console.error('Error inserting health data:', error);
                res.status(500).send({ message: 'Failed to create healthHub' })
            }
        })

        // my medicines to filter by seller email
        app.get('/my-medicines', async (req, res) => {
            const email = req.query.email;
            if (!email) return res.status(400).send({ message: 'Email required' });

            try {
                const medicines = await healthHubCollection.find({ sellerEmail: email }).toArray();
                res.send(medicines);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch medicines' });
            }
        });


        // slider implementation
        app.get('/slider', async (req, res) => {
            const sliderItems = await db.collection('sliderItems').find({ isActive: true }).toArray();
            res.send(sliderItems);
        });


        // Get all advertised medicines for admin (includes isActive flag)
        app.get('/advertised-medicines', async (req, res) => {
            const advertised = await sliderCollection.find().toArray();
            res.send(advertised);
        });

        // Toggle slide status (add/remove from slider)
        app.patch('/advertised-medicines/:id/toggle', async (req, res) => {
            const id = req.params.id;
            const { isActive } = req.body;

            try {
                const result = await sliderCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isActive } }
                );
                res.send(result);
            } catch (error) {
                console.error('Error toggling slider status:', error);
                res.status(500).send({ message: 'Failed to update slider status' });
            }
        });

        //  GET all users
        app.get('/users', async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                res.send(users);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch users' });
            }
        });

        //  PATCH user role
        app.patch('/users/:id/role', async (req, res) => {
            const userId = req.params.id;
            const { role } = req.body;

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { role } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update user role' });
            }
        });

        // conceptul session user role
        app.post('/user', async (req, res) => {
            const userData = req.body;
            // userData.role = 'customer'
            userData.created_at = new Date().toISOString()
            userData.last_loggedIn = new Date().toISOString()
            const query = {
                email: userData?.email,
            }

            const alreadyExists = await usersCollection.findOne(query)

            console.log('user already exists:', !!alreadyExists)
            if (!!alreadyExists) {

                console.log('updating user data .....')
                const result = await usersCollection.updateOne(query, { $set: { last_loggedIn: new Date().toISOString() }, })
                return res.send(result)
            }


            console.log('creating user data .....')

            // return console.log(userData)

            const result = await usersCollection.insertOne(userData)
            res.send(result)
        })

        // get a user's role
        app.get('/user/role/:email', async (req, res) => {
            const email = req.params.email;
            const result = await usersCollection.findOne({ email })
            if (!result) return res.status(404).send({ message: 'user not found.' })
            res.send({ role: result?.role })
        })


        app.get("/categories", async (req, res) => {
            try {
                const categoriesWithCount = await categoryCollection.aggregate([
                    {
                        $lookup: {
                            from: 'healthHub',
                            localField: 'categoryName',
                            foreignField: 'category',
                            as: 'matchedMedicines'
                        }
                    },
                    {
                        $addFields: {
                            medicineCount: { $size: '$matchedMedicines' }
                        }
                    },
                    {
                        $project: {
                            // শুধুমাত্র matchedMedicines ফিল্ডটি বাদ দিন।
                            // _id, categoryName, imageURL, এবং medicineCount
                            // স্বয়ংক্রিয়ভাবে অন্তর্ভুক্ত হবে।
                            matchedMedicines: 0
                        }
                    }
                ]).toArray();

                res.send(categoriesWithCount);
            } catch (error) {
                console.error('মেডিসিনের সংখ্যা সহ ক্যাটাগরি ফেচ করতে ত্রুটি:', error);
                res.status(500).send({ message: 'ক্যাটাগরি ফেচ করতে ব্যর্থ হয়েছে' });
            }
        });

        app.post("/categories", async (req, res) => {
            const category = req.body;
            const result = await categoryCollection.insertOne(category);
            res.send(result);
        });

        app.patch("/categories/:id", async (req, res) => {
            const id = req.params.id;
            const { categoryName } = req.body;
            const result = await categoryCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { categoryName } }
            );
            res.send(result);
        });

        app.delete("/categories/:id", async (req, res) => {
            const id = req.params.id;
            const result = await categoryCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // GET all payments
        app.get('/payments', async (req, res) => {
            const result = await paymentCollection.find().toArray()
            res.send(result)
        })

        // POST a new payment (এটি নতুন যোগ করতে হবে)
        app.post('/payments', async (req, res) => {
            try {
                const paymentInfo = {
                    ...req.body,
                    date: new Date()
                };
                const result = await paymentCollection.insertOne(paymentInfo);
                res.status(201).send({ success: true, message: 'পেমেন্ট তথ্য সফলভাবে সংরক্ষিত হয়েছে', insertedId: result.insertedId });
            } catch (error) {
                console.error('পেমেন্ট তথ্য সংরক্ষণ করতে এরর:', error);
                res.status(500).send({ success: false, message: 'পেমেন্ট তথ্য সংরক্ষণ করতে ব্যর্থ হয়েছে।' });
            }
        });

        // Get payments for a specific seller
        app.get('/payments/by-seller', async (req, res) => {
            const { email } = req.query;
            if (!email) return res.status(400).send({ message: 'Seller email is required' });

            try {
                const payments = await paymentCollection
                    .find({ 'cartItems.sellerEmail': email }) // assume this field exists in payment doc
                    .toArray();
                res.send(payments);
            } catch (error) {
                console.error('Failed to fetch seller payments:', error);
                res.status(500).send({ message: 'Failed to fetch payments' });
            }
        });




        // GET /sales
        app.get('/sales', async (req, res) => {
            try {
                const payments = await paymentCollection.find().toArray();

                // Flatten each cartItem with related payment info
                const salesData = payments.flatMap(payment =>
                    payment.cartItems.map(item => ({
                        medicineName: item.title,
                        sellerEmail: item.sellerEmail,
                        buyerEmail: payment.buyerEmail,
                        totalPrice: item.price * (item.quantity || 1),
                        date: payment.date || new Date(), // Add date at payment time
                        status: item.status
                    }))
                );

                res.send(salesData);
            } catch (error) {
                console.error('Failed to fetch sales data:', error);
                res.status(500).send({ message: 'Failed to fetch sales data' });
            }
        });


        // PATCH payment status
        app.patch('/payments/:id', async (req, res) => {
            const { id } = req.params
            const { status } = req.body
            const result = await paymentCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            )
            res.send(result)
        })

        // POST advertisement request by seller
        app.post('/advertised-medicines', async (req, res) => {
            try {
                console.log('প্রাপ্ত ডাটা:', req.body);
                const ad = req.body;
                ad.isActive = false; // default inactive
                const result = await sliderCollection.insertOne(ad);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to submit advertisement request' });
            }
        });

        // Get payments for a specific user
        app.get('/payments/user', async (req, res) => {
            const email = req.query.email;
            console.log('📩 Fetching payments for buyerEmail:', email);
            if (!email) return res.status(400).send({ message: 'Email is required' });

            try {
                const payments = await paymentCollection.find({ buyerEmail: email }).toArray();
                res.send(payments);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch user payments' });
            }
        });




        // discount section (পরিবর্তিত)
        app.get('/medicines/discount', async (req, res) => {
            try {
                const discounted = await healthHubCollection.find({ discount: { $gt: 0 } }).toArray();
                res.send(discounted);
            } catch (error) {
                console.error('ডিসকাউন্ট মেডিসিন ফেচ করতে ত্রুটি:', error);
                res.status(500).send({ message: 'ডিসকাউন্ট মেডিসিন ফেচ করতে ব্যর্থ হয়েছে' });
            }
        });

        // stripe

        app.post('/create-payment-intent', async (req, res) => {
            const { amount } = req.body;

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: Math.round(amount * 100), // cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                console.error('Stripe error:', error);
                res.status(500).send({ message: 'Failed to create payment intent' });
            }
        });

        //for admin home
        app.get('/admin/stats', async (req, res) => {
            try {
                const payments = await paymentCollection.find().toArray();

                const totalPaid = payments
                    .filter(p => p.status === 'paid')
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

                const totalPending = payments
                    .filter(p => p.status === 'pending')
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

                res.send({
                    paid: totalPaid,
                    pending: totalPending
                });
            } catch (error) {
                console.error('Error fetching admin stats:', error);
                res.status(500).send({ message: 'Failed to fetch admin stats' });
            }
        });

        

        // Best Sellers API
        app.get("/best-sellers", async (req, res) => {
            try {
                const bestSellers = await healthHubCollection
                    .find({ bestSeller: true }) // fetch only marked best sellers
                    .limit(8) // limit results
                    .toArray();

                res.send(bestSellers);
            } catch (error) {
                console.error("Error fetching best sellers:", error);
                res.status(500).send({ message: "Server error" });
            }
        });




        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



// sample route
app.get('/', (req, res) => {
    res.send('health hub server is running');
});

// start the server
// app.listen(port, () => {
//     console.log(`server is running on port ${port}`)
// });

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`🎯 CORS allowed origins:`, allowedOrigins);
    console.log(`📱 Client URL: ${process.env.CLIENT_URL}`);
});