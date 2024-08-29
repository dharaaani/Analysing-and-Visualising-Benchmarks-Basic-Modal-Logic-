const express = require('express');
const multer = require('multer');
const path = require('path');
const { exec } = require('child_process');
const mysql = require('mysql2');
const cors = require('cors');
const { listenerCount } = require('process'); 
const bodyParser = require('body-parser');
const PCA = require('ml-pca');
const { Matrix } = require('ml-matrix');


const app = express();
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(express.json());  // To parse JSON bodies
app.use(cors());  // Enable CORS for all routes

// MySQL connection (update with your MySQL credentials)
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Dharani13@',
    database: 'benchmark_db'
});

db.connect(err => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        throw err;
    }
    console.log('Connected to MySQL');
});

// Set up storage for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Serve the upload form
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Handle file upload and preprocessing
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    console.log(`File uploaded to: ${filePath}`);

    const pythonScript = path.join(__dirname, 'scripts', 'preprocessing.py');
    console.log(`Executing Python script: ${pythonScript}`);

    exec(`python ${pythonScript} ${filePath}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing Python script: ${error.message}`);
            return res.status(500).send(`Server Error: ${error.message}`);
        }
        if (stderr) {
            console.error(`Python Script Error: ${stderr}`);
            return res.status(500).send(`Script Error: ${stderr}`);
        }
        console.log(`Python Script Output: ${stdout}`);
        res.send(`CSV file successfully uploaded and processed. Check the output in the uploads directory.`);
    });
});


// Handle SQL query execution
app.post('/query', (req, res) => {
    const sqlQuery = req.body.sql_query;

    // Debugging: log the incoming request body
    console.log('Request Body:', req.body);

    // Check if sql_query is present and is a string
    if (!sqlQuery || typeof sqlQuery !== 'string') {
        return res.status(400).send('Invalid SQL query.');
    }

    // Trim the query to remove unnecessary whitespace
    const trimmedQuery = sqlQuery.trim();

    db.query(trimmedQuery, (err, results) => {
        if (err) {
            console.error(`Error executing query: ${err.message}`);
            return res.status(500).send(`Server Error: ${err.message}`);
        }

        
        console.log('Query Results:', results);

        res.json(results);
    });
});

app.post('/filter', (req, res) => {
    const { prover_name, system_name, exec_time, result } = req.body;

    let query = 'SELECT * FROM measurements WHERE 1=1';
    const queryParams = [];

    if (prover_name) {
        query += ' AND LOWER(TRIM(Prover)) = LOWER(TRIM(?))';
        queryParams.push(prover_name);
    }
    if (system_name) {
        query += ' AND LOWER(TRIM(System_Name)) = LOWER(TRIM(?))';
        queryParams.push(system_name);
    }
    if (exec_time) {
        query += ' AND Execution_Time = ?';
        queryParams.push(exec_time.trim());
    }
    if (result) {
        query += ' AND LOWER(TRIM(Result)) = LOWER(TRIM(?))';
        queryParams.push(result);
    }

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(`Error executing query: ${err.message}`);
            return res.status(500).send(`Server Error: ${err.message}`);
        }

        res.json(results);
    });
});



// Handle aggregate calculations (e.g., average execution time)
app.post('/aggregate', (req, res) => {
    const { prover_name } = req.body;
    let query = 'SELECT AVG(Execution_Time) as avg_execution_time FROM measurements WHERE Execution_Time < 9999999';

    if (prover_name) {
        query += ` AND Prover LIKE '%${prover_name}%'`;
    }

    db.query(query, (err, results) => {
        if (err) {
            console.error(`Error executing query: ${err.message}`);
            return res.status(500).send(`Server Error: ${err.message}`);
        }
        res.json(results);
    });
});

app.post('/compare', (req, res) => {
    const prover = req.body.prover.toLowerCase().trim(); 
    const systems = req.body.systems.map(system => system.trim().toLowerCase());

    console.log(`Received comparison request for: ${prover} with systems: ${JSON.stringify(systems)}`);

    const query = `
        SELECT * FROM measurements 
        WHERE LOWER(TRIM(System_Name)) IN (${systems.map(() => '?').join(',')}) 
        AND LOWER(TRIM(Result)) IN ('sat', 'unsat') 
        AND Execution_Time < 99999
        AND LOWER(TRIM(Prover)) LIKE ? 
    `;

    const queryParams = [...systems, `${prover}%`];

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error("Database query error:", err);
            res.status(500).send('Internal Server Error');
            return;
        }

        console.log("Query Results:", results);

        const formattedData = systems.map(system => ({
            system: system,
            executionTimes: [],
            indices: [],
            color: getRandomColor()
        }));

        results.forEach(row => {
            const systemIndex = systems.indexOf(row.System_Name.toLowerCase());
            if (systemIndex >= 0) {
                formattedData[systemIndex].executionTimes.push(parseFloat(row.Execution_Time));
                formattedData[systemIndex].indices.push(formattedData[systemIndex].executionTimes.length);
            }
        });

        console.log("Formatted Data for Cactus Plot:", formattedData);
        res.json(formattedData);
    });
});


function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Function to assign colors to systems
function getColorForSystem(systemName) {
    const colors = {
        'bbtab': '#FF5733',   // Red-orange
        'inkresat': '#33FF57', // Green
        'vampire': '#3357FF',  // Blue
        'spartacus': '#FF33A8', // Pink
        'ksp': '#33FFF6'      // Cyan
    };

    return colors[systemName.toLowerCase()] || '#000000'; // Default to black if system not found
}


app.post('/visualize', (req, res) => {
    const { prover } = req.body;  // Destructure prover from the request body

    if (!prover) {
        return res.status(400).json({ error: 'No prover selected' });
    }

    const proverInput = `${prover.toLowerCase()}%`;  // Prepare the input for the SQL query

    console.log('Executing query with:', proverInput);  // Log the proverInput for debugging

    const query = `
        SELECT system_name, result, execution_time 
        FROM measurements 
        WHERE LOWER(TRIM(Prover)) LIKE ?
        AND LOWER(TRIM(result)) IN ('sat' , 'unsat')
        AND execution_time < 99999 
        ORDER BY system_name, result;
    `;

    db.query(query, [proverInput], (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            return res.status(500).json({ error: 'Failed to retrieve data' });
        }

        const dataBySystem = {};
        results.forEach(row => {
            if (!dataBySystem[row.system_name]) {
                dataBySystem[row.system_name] = {
                    system: row.system_name,
                    executionTimes: [],
                    result: [],
                    color: getColorForSystem(row.system_name)
                };
            }
            dataBySystem[row.system_name].executionTimes.push(parseFloat(row.execution_time));
            dataBySystem[row.system_name].result.push(row.result.trim());
        });

        const responseData = Object.values(dataBySystem);
        console.log('Response Data:', responseData); // Log the response data to check its content
        res.json(responseData);
    });
});

 
app.post('/get_pca_data', (req, res) => {
    const { prover, system } = req.body;

    if (!prover || !system) {
        return res.status(400).json({ error: 'Prover and system are required' });
    }

    const query = `
        SELECT * FROM pca
        WHERE LOWER(TRIM(Prover)) = LOWER(TRIM(?))
        AND LOWER(TRIM(System_name)) = LOWER(TRIM(?))
    `;

    const queryParams = [prover, system];

    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error('Error executing query:', err.message);
            return res.status(500).json({ error: 'Server Error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'No data found for the selected prover and system' });
        }

        res.json(results);
    });
});









      
// Start the server
app.listen(3000, () => {

    console.log('Server started on http://localhost:3000');
});
