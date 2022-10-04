const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const ObjectId = require('mongodb').ObjectId;
const dotenv = require('dotenv').config();


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.41bbapx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
	try {
		const servicesCollection = client.db("doctors-portal").collection("services");
		const bookingCollection = client.db("doctors-portal").collection("booking");
		console.log('Database connected');

		// GET API SERVICES
		app.get('/services', async (req, res) => {
			const query = {};
			const cursor = servicesCollection.find(query);
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
				const booked = servicesBooking.map(s => s.slot);
				const available = service.slot.filter(s => !booked.includes(s));
				service.available = available;
			})

			res.send(services);
		})

		// Post
		app.post('/booking', async (req, res) => {
			const booking = req.body;
			console.log(booking);
			const result = await bookingCollection.insertOne(booking);
			res.send({ success: true, result });
		});



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