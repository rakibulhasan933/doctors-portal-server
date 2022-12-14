const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const ObjectId = require('mongodb').ObjectId;
const dotenv = require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.t2kmaoa.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader) {
		return res.status(401).send({ message: 'Unauthorized access' });
	};
	const token = authHeader.split(' ')[1];
	jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
		if (err) {
			return res.status(403).send({ message: 'Forbidden access' })
		}
		req.decoded = decoded;
		next();
	});
}

async function run() {
	try {
		const servicesCollection = client.db("doctors_portal").collection("services");
		const bookingCollection = client.db("doctors_portal").collection("booking");
		const usersCollection = client.db("doctors_portal").collection("users");
		const doctorsCollection = client.db("doctors_portal").collection("doctors");
		const paymentsCollection = client.db("doctors_portal").collection("payments");
		console.log('Database connected');

		const verifyAdmin = async (req, res, next) => {
			const requester = req?.decoded.email;
			const requesterAccount = await usersCollection.findOne({ email: requester });
			if (requesterAccount?.role === 'admin') {
				next();
			}
			else {
				res.status(403).send({ message: 'forbidden access' });
			}
		}


		// PAYMENT 
		app.post('/create-payment-intent', async (req, res) => {
			const service = req.body;
			const price = service.price;
			const amount = price * 100;
			const paymentIntent = await stripe.paymentIntents.create({
				amount: amount,
				currency: "usd",
				payment_method_types: [
					"card"
				],
			});
			res.send({
				clientSecret: paymentIntent.client_secret,
			});
		});

		// payment update
		app.patch('/booking/:id', async (req, res) => {
			const id = req.params.id;
			const payment = req.body;
			const filter = { _id: ObjectId(id) };
			const updateDoc = {
				$set: {
					paid: true,
					transactionId: payment.transactionId
				}
			};
			const result = await paymentsCollection.insertOne(payment);
			const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
			res.send({ updateDoc, result, updatedBooking });
		})

		// GET API SERVICES
		app.get('/services', async (req, res) => {
			const cursor = servicesCollection.find({}).project({ name: 1 });
			const service = await cursor.toArray();
			res.send(service);
		});
		// Find all services slots
		app.get('/available', async (req, res) => {
			const date = req.query.date;
			const services = await servicesCollection.find().toArray();
			const query = { date: date };
			const booking = await bookingCollection.find(query).toArray();
			// 3rd
			services.forEach(service => {
				const servicesBooking = booking.filter(b => b.treatment === service.name);
				const bookedSlots = servicesBooking.map(s => s.slot);
				const available = service.slots.filter(s => !bookedSlots.includes(s));
				service.slots = available;
			})
			res.send(services);
		})

		// Post
		app.post('/booking', verifyJWT, async (req, res) => {
			const booking = req.body;
			const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
			const exists = await bookingCollection.findOne(query);
			if (exists) {
				return res.send({ success: false, booking: exists })
			}
			const result = await bookingCollection.insertOne(booking);
			return res.send({ success: true, result });
		});

		// User specific booking List API
		app.get('/booking', verifyJWT, async (req, res) => {
			const patient = req.query.patient;
			const decodedEmail = req.decoded.email;
			if (patient === decodedEmail) {
				const query = { patient: patient };
				const booking = await bookingCollection.find(query).toArray();
				return res.send(booking);
			}
			else {
				return res.status(403).send({ message: 'Forbidden access' })
			};
		});

		// All booking
		app.get('/bookings', verifyJWT, verifyAdmin, async (req, res) => {
			const booking = await bookingCollection.find().toArray();
			res.send(booking);
		});
		// id specific Booking
		app.get('/booking/:id', verifyJWT, async (req, res) => {
			const id = req.params.id;
			const query = { _id: ObjectId(id) };
			const booking = await bookingCollection.findOne(query);
			res.send(booking);
		});
		// admin
		app.get('/admin/:email', async (req, res) => {
			const email = req.params.email;
			const user = await usersCollection.findOne({ email: email });
			const isAdmin = user?.role === 'admin';
			res.send({ admin: isAdmin });
		})

		// make admin
		app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
			const email = req.params.email;
			const filter = { email: email };
			const updateDoc = {
				$set: { role: 'admin' },
			};
			const result = await usersCollection.updateOne(filter, updateDoc);
			res.send(result);
		});

		// user added
		app.put('/user/:email', async (req, res) => {
			const email = req.params.email;
			const user = req.body;
			const filter = { email: email };
			const options = { upsert: true };
			const updateDoc = {
				$set: user
			};
			const result = await usersCollection.updateOne(filter, updateDoc, options);
			const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
			res.send({ result, token });
		});
		// ALL USER LIST
		app.get('/users', verifyJWT, async (req, res) => {
			const users = await usersCollection.find().toArray();
			res.send(users);
		});
		// POST DOCTOR
		app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
			const doctor = req.body;
			const result = await doctorsCollection.insertOne(doctor);
			res.send(result);
		});
		// GET DOCTOR
		app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
			const doctors = await doctorsCollection.find().toArray();
			res.send(doctors);
		});
		// DOCTOR DELETED
		app.delete('/doctor-remove/:id', verifyJWT, verifyAdmin, async (req, res) => {
			const id = req.params.id;
			const query = { _id: ObjectId(id) };
			const result = await doctorsCollection.deleteOne(query);
			res.send(result);
		});
		// USER DELETED
		app.delete('/user-remove/:id', verifyJWT, verifyAdmin, async (req, res) => {
			const id = req.params.id;
			const query = { _id: ObjectId(id) };
			const result = await usersCollection.deleteOne(query);
			res.send(result);
		})


	} finally {
		// await client.close();
	}
}
run().catch(console.dir);


app.get('/', (req, res) => {
	res.send('Doctors Portal Server Running')
})

app.listen(port, () => {
	console.log(`Doctors Portal Server app listening on port ${port}`)
});