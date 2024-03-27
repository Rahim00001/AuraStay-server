const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const morgan = require('morgan');
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

// middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5173'],
    credentials: true,
    optionsSuccessStatus: 200,
}));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// custom middleware
const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;
    console.log('value of token in middleware:', token)
    if (!token) {
        return res.status(401).send({ message: 'not authorized' })
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        // error
        if (err) {
            console.log(err);
            return res.status(401).send({ message: 'unauthorized' })
        }
        // valid
        console.log('value in the token:', decoded)
        req.user = decoded;
        next();
    })
}

const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.lk92epi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const usersCollection = client.db('auraStayDB').collection('users')
        const roomsCollection = client.db('auraStayDB').collection('rooms')
        const bookingsCollection = client.db('auraStayDB').collection('bookings')


        // auth related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            console.log(user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '365d' })

            res
                .cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
                })
                .send({ success: true })
        })


        // Logout
        app.get('/logout', async (req, res) => {
            try {
                res
                    .clearCookie('token', {
                        maxAge: 0,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                    })
                    .send({ success: true })
                console.log('Logout successful')
            } catch (err) {
                res.status(500).send(err)
            }
        })

        // Save or modify user email, status in DB
        app.put('/users/:email', async (req, res) => {
            const email = req.params.email
            const user = req.body
            const query = { email: email }
            const options = { upsert: true }
            const isExist = await usersCollection.findOne(query)
            console.log('User found?----->', isExist)
            if (isExist) return res.send(isExist)
            const result = await usersCollection.updateOne(
                query,
                {
                    $set: { ...user, timestamp: Date.now() },
                },
                options
            )
            res.send(result)
        })

        // Get user role
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email
            const result = await usersCollection.findOne({ email })
            res.send(result)
        })

        // Get all rooms
        app.get('/rooms', async (req, res) => {
            const result = await roomsCollection.find().toArray()
            res.send(result)
        })

        // Get single room data
        app.get('/room/:id', async (req, res) => {
            const id = req.params.id
            const result = await roomsCollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })

        // add a room in database
        app.post('/rooms', verifyToken, async (req, res) => {
            const room = req.body
            const result = await roomsCollection.insertOne(room)
            res.send(result)
        })

        //get rooms for host
        app.get('/rooms/:email', async (req, res) => {
            const email = req.params.email
            const result = await roomsCollection
                .find({ 'host.email': email })
                .toArray()
            res.send(result)
        })

        // Generate client secret for stripe payment
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const { price } = req.body
            const amount = parseInt(price * 100)
            if (!price || amount < 1) return
            const { client_secret } = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card'],
            })
            res.send({ clientSecret: client_secret })
        })

        // Save booking info in booking collection
        app.post('/bookings', verifyToken, async (req, res) => {
            const booking = req.body
            const result = await bookingsCollection.insertOne(booking)
            res.send(result)
        })

        // update room booking status
        app.patch('/rooms/status/:id', async (req, res) => {
            const id = req.params.id
            const status = req.body.status
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    booked: status,
                },
            }
            const result = await roomsCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // Get all bookings for guest
        app.get('/bookings', verifyToken, async (req, res) => {
            const email = req.query.email
            if (!email) return res.send([])
            const query = { 'guest.email': email }
            const result = await bookingsCollection.find(query).toArray()
            res.send(result)
        })

        // Get all bookings for host
        app.get('/bookings/host', verifyToken, async (req, res) => {
            const email = req.query.email
            if (!email) return res.send([])
            const query = { host: email }
            const result = await bookingsCollection.find(query).toArray()
            res.send(result)
        })

        // Get all users
        app.get('/users', verifyToken, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })

        // Update user role
        app.put('/users/update/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const user = req.body
            const query = { email: email }
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    ...user,
                    timestamp: Date.now(),
                },
            }
            const result = await usersCollection.updateOne(query, updateDoc, options)
            res.send(result)
        })





        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
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
    res.send('AuraStay is working')
})

app.listen(port, () => {
    console.log(`AuraStay server is running on ${port}`)
})