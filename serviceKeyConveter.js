const fs = require('fs');
const path = require('path');

// Look for a firebase-admin json file in the directory
const files = fs.readdirSync(__dirname);
const firebaseKeyFile = files.find(file => file.endsWith('.json') && file.includes('firebase-adminsdk'));

if (!firebaseKeyFile) {
  console.error("Error: No Firebase Admin JSON key file found in the root directory!");
  process.exit(1);
}

console.log(`Using key file: ${firebaseKeyFile}`);
const jsonData = fs.readFileSync(path.join(__dirname, firebaseKeyFile));

try {
  // Validate that it's correct JSON
  JSON.parse(jsonData);
  const base64String = Buffer.from(jsonData, 'utf-8').toString('base64');
  console.log("\n--- BASE64 ENCODED STRING ---");
  console.log(base64String);
  console.log("-----------------------------\n");
  console.log("Copy the entire string above and set it as the value for FIREBASE_SERVICE_ACCOUNT on Render or Vercel.");
} catch (e) {
  console.error("Error: The file is not a valid JSON file.", e);
}
