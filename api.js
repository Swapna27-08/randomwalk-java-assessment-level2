import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';
import cors from 'cors';
import bcrypt from 'bcryptjs'; // Use bcryptjs
import jwt from 'jsonwebtoken'; // Import JWT

const db = new pg.Client({
user: process.env.DB_USER,
host: process.env.DB_HOST,
database: process.env.DB_DATABASE,
password: process.env.DB_PASSWORD,
port: process.env.DB_PORT,
});

db.connect();

const app = express();
const port = 3000;
const secretKey = process.env.JWT_SECRET || 'your_secret_key'; // Use a secret

app.use(cors());
app.use(bodyParser.json());

// Middleware to authenticate JWT tokens
const authenticateToken = (req, res, next) => {
const authHeader = req.headers['authorization'];
const token = authHeader && authHeader.split(' ')[1];
if (token == null) return res.sendStatus (401); // No token, unauthorized

jwt.verify(token, secretKey, (err, user) => {
if (err) return res.sendStatus (403); // Invalid token
req.user = user; // Attach user info to the request
next();
});
};

// Function to generate a hash from first name and last name
const generateHash = async (fname, Iname) => {
    const saltRounds = 10;
    const hash = await bcrypt.hash('${fname.toLowerCase()}${lname.toLowerCase()}', saltRounds);
    return hash;
    };

    // User login (for admin access)
    app.post("/api/v1/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.query("SELECT * FROM USERS WHERE username = $1;", [username]);
        if (user.rows.length == 0) {
        return res.status(404).json({ error: "User not found" });
        }

        const validPassword = await bcrypt.compare (password, user.rows[0].password);
        if (!validPassword) {I
        return res.status(401).json({ error: "Invalid password" });
        }

        const token = jwt.sign({username: user.rows[0].username}, secretKey, { expiresIn: '1h' });
        res.json({token});
    } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Error logging in' });
    }
    });

    // Example route for testing authentication
    app.get("/", async (req, res) => {
    try {
    const response = await db.query("SELECT * FROM voting_room;");
    res.json({
    "status": "Running",
    "rooms": response.rows,
    });
    } catch (error) {
        console.log(error);
    }
    });

  // Create a voting room (Protected)
  app.post("/api/v1/voting-room", authenticateToken, async (req, res) => {
        try {
            const { name, description} = req.body;
            const response = await db.query("INSERT INTO VOTING ROOM (name, description) VALUES ($1, $2) RETURNING *;", [name, description]);
            res.json({
                "status": "Created",
                "room_id": response.rows[0].room_id,
           });
        } catch (error) {
            console.log(error);
            res.status(500).json({ error: 'Error creating voting room' });
        }
    });

    // Add new Candidates (Protected)
    app.post("/api/v1/candidates", authenticateToken, async (req, res) => {
        const {fname, lname, room_id} = req.body;
        try {
            const add_candidate = await db.query("INSERT INTO CANDIDATE (fname, Iname) VALUES ($1, $2) RETURNING *;", [fname, lname]);
            const response = await db.query("INSERT INTO STANDING IN(candidate_id, room_id) VALUES ($1, $2) RETURNING *;", [add_candidate.rows[0].id, room_id]);
            res.json({ status: 'Candidate added', candidate_id: response.rows[0].candidate_id });
        } catch (error) {
            console.log(error),
            res.status(500).json({ error: 'Error adding candidate' });
        }
    });

    // Add new Voters (Protected)
    app.post("/api/v1/voters", authenticateToken, async (req, res) => {
    const {fname, Iname} = req.body;
    try {
        const hash = await generateHash(fname, Iname);
        const response = await db.query("INSERT INTO VOTER (fname, lname, hash) VALUES ($1, $2, $3) RETURNING *;", [fname, lname, hash]);
        res.json({ status: 'Voter added', voter_id: response.rows[0].id});
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error adding voter' });
       }
    });

    const authenticateVoter = async (voter_id) => {
        const response = await db.query("SELECT id, hash FROM VOTER WHERE id = $1;", [voter_id]);
        if (response.rows.length > 0) {
        return response.rows[0];
        }
        return null;
    };

    // Vote for a Candidate (No Authentication required for casting votes)
    app.post("/api/v1/voting-room/:id/vote", async (req, res) => {
        const {votes, voter_id, fname, lname} = req.body;
        const inputHash= `${fname.toLowerCase()}${lname.toLowerCase()}`;

        const voter = await authenticateVoter (voter_id);
        if (!voter) {
        return res.status(404).json({ status: 'Voter not found' });
        }

        const match = await bcrypt.compare (inputHash, voter.hash);
        if (!match) {
            return res.status(401).json({ status: 'Invalid credentials'});
        }

        try {
            const totalVotes =  Object.values(votes).reduce((a, b) => a + b);
            if (totalVotes != 10) {
            return res.status(400).json({ error: 'Votes must add up to 10' });
            }

            const alreadyVoted = await db.query("SELECT * FROM VOTED IN WHERE voter_id ■ $1 AND room_id = $2;", [voter.id, req.params.id]);
            if (alreadyVoted.rows.length > 0) {
            return res.json({ "status": "Already Voted" });
            }

            const n = Object.values(votes).filter(value => value > 0).length;
            
            for (const candidate of Object.keys(votes)) {
                const value = votes [candidate];
                if (value>0) {
                    await db.query("INSERT INTO VOTE (room_id, candidate_id, n_votes, n_voted) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM STANDING_IN WHERE username = $1;", 
                    [req.params.id, candidate, value, n]);
                }
            }

            await db.query("INSERT INTO VOTED_IN(voter_id, room_id) VALUES ($1, $2);", [voter.id, req.params.id]);
            res.json.({ "status": "Voted" });
        } catch (error) {
            console.log(error);
            res.status(500).json({ error: 'Error casting vote' });
        }
    });

    //Get the results (No authentication required to view results)
    app.get("/api/v1/voting-room/:id/results", async (req, res) =>{
        const decay = 0.125;
        try {
            const candidates = await db.query("SELECT candidate_id FROM STANDING IN WHERE room_id = $1;", [req.params.id]);
            const results = {};
            const ones = {};

            for (const candidate of candidates.rows) {
                const response = await db.query("SELECT n_votes, n_voted FROM VOTE WHERE room_id = $1 AND candidate_id = $2;", [req.params.id, candidate.candidate])
                const rows = response.rows;
                let vote_count = 0;
                let one_count = 0;

                rows.forEach(row => {
                    if (row.n_votes === 0) {
                        one_count += 1;
                    }
                    const weight = 1 - (candidates.rows.length - row.n_voted + 1) * decay;
                    vote_count += row.n_votes * weight;
                });
                results[candidate.candidate_id] = vote_count.toFixed(2);
                ones [candidate.candidate_id] =one_count;
            }

            let winner = Object.keys (results).reduce((a, b) => results[a] > results [b]?a : b);
            const ties = Object.keys(results).filter(candidate => results [candidate] === results[winner]);
            if (ties.length > 1) {
                winner = ties.reduce((a, b) => ones[a] < ones [b] ? a : b);
            }

            res.json({
                "results": results,
                "winner": winner,
            });

        } catch (error) {
            console.log(error); I
            res.status(500).json({ error: 'Error retrieving results' });  
        }
    });  

    app.listen(port, () => {
        console.log('listening on port ${port}');
    });