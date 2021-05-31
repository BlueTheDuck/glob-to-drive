const { authenticate } = require('@google-cloud/local-auth');
const path = require("path");
const fs = require("fs");

// Input file, downloaded from Google Console by clicking "Download JSON"
const KEYFILE = path.join(__dirname, "./client_id.json");
// Output file, will be overwritten
const TOKEN_PATH = path.join(__dirname, "./token.json");

/**
 * These are the scopes. The full list is here: https://developers.google.com/identity/protocols/oauth2/scopes#drive
 * The scopes tell Google what does your app want to do. Using a feature without declaring it here will fail
 * Remember to recreate the refresh token each time the scopes are changed
 * */
const SCOPES = require("./scopes.json");

authenticate({
    keyfilePath: KEYFILE,
    scopes: SCOPES,
}).then(auth => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(auth.credentials));
});