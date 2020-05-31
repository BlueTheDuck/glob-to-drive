const { authenticate } = require('@google-cloud/local-auth');
const path = require("path");
const fs = require("fs");

const KEYFILE = path.join(__dirname, "./client_id.json");
const TOKEN_PATH = path.join(__dirname, "./token.json");

const SCOPES = require("./scopes.json");

authenticate({
    keyfilePath: KEYFILE,
    scopes: SCOPES,
}).then((auth) => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(auth.credentials));
});