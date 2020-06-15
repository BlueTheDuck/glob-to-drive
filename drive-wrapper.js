const { google } = require("googleapis");
const core = require("@actions/core");
const fs = require("fs");
const path = require("path");

const FOLDER_MIMETYPE = "application/vnd.google-apps.folder";

//#region GApi
async function login(credentials, token) {
    try {
        /**
         * Get info required to perform the auth from the inputs vars
         * credentials is a JSON value downloaded from the Google Console OAuth
         * token can ve generated running `node login.js`. The file `token.json` will then contain the value
         * UPLOAD THIS VALUES AS SECRETS! NEVER KEEP THEM UNENCRYPTED
         */
        //const credentials = JSON.parse(core.getInput("credentials", { required: true }));
        //const token = JSON.parse(core.getInput("token", { required: true }));
        let auth = new google.auth.OAuth2(
            credentials.web.client_id,
            credentials.web.client_secret,
            credentials.web.redirect_uris[0]
        )
        auth.setCredentials(token);
        core.info("Auth successful");
        return auth;
    } catch (e) {
        return Promise.reject(e);
    }
}
function createDriveApi(auth) {
    // Create the Drive API and store it in the global var `drive`
    return Drive = google.drive({
        version: "v3",
        auth,
    });
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 */
async function list(drive, q) {
    let files = [];
    let pageToken = undefined;
    do {
        let { data } = await drive.files.list({
            pageSize: 10,
            q,
            pageToken
        });
        files = files.concat(data.files);
        pageToken = data.nextPageToken;
    } while (pageToken !== undefined);
    await Promise.all(files.map(async file => {
        const { data } = await drive.files.get({ fileId: file.id, fields: "appProperties" });
        file.appProperties = data.appProperties;
    }))

    return files;
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param options.path Path to the file that will be uploaded
 * @param options.name Name of the file in Drive. Defaults to `options.path` if left empty
 * @param options.mimeType Mimetype (Used both for media: and requestBody:)
 * @param options.parents Parent folder. If empty, the file will be uploaded to My Drive
 */
async function upload(drive, options) {
    // Patch parents, it has to be an array
    if (!options.parents) {
        options.parents = [];
    } else if (typeof options.parents === 'string') {
        options.parents = [options.parents]
    }
    core.info(`Uploading file ${options.path} with mime-type ${options.mimeType || "empty"}`);
    try {
        await drive.files.create({
            requestBody: {
                mimeType: options.mimeType,
                name: options.name || options.path,
                parents: options.parents,
                appProperties: {
                    source: options.path
                }
            },
            media: {
                mimeType: options.mimeType,
                body: fs.createReadStream(options.path)
            }
        });
    } catch (e) {
        return Promise.reject(e);
    }
}

/**
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param {string} options.fileId
 * @param options.file File to get the content from
 */
async function update(drive, options) {
    core.info(`Updating ${options.file}`);
    await drive.files.update({
        fileId: options.fileId,
        media: {
            body: fs.createReadStream(options.file)
        }
    })
}

/**
 * Return the folder info
 * @param {import("googleapis").drive_v3.Drive} drive Google Drive context
 * @param {object} options
 * @param {string} options.path Path in the format 'a/b/c' relative to parent. The folder would be 'c'
 * @param {string} options.parent ID of the folder
 * @param {boolean} options.create Create if it doesn't exists. Error otherwise
 * @returns {String} Folder data
 */
async function folder(drive, options) {
    let pathStructure = options.path.split(path.sep);
    core.info(`Path structure: ${pathStructure}`);
    let parentId = options.parent || `root`;
    for (let folderName of pathStructure) {
        let q = `'${parentId}' in parents and name = '${folderName}'`;
        let [folder] = await list(drive, q).catch(e => Promise.reject(e.toString()));
        let currentFolderId = folder ? folder.id : undefined;

        if (currentFolderId === undefined && options.create) {
            currentFolderId = await drive.files.create({
                requestBody: {
                    name: folderName,
                    parents: [parentId],
                    mimeType: FOLDER_MIMETYPE
                },
                fields: 'id'
            }).then(res => res.data.id).catch(e => Promise.reject(e.toString()));
            core.info(`Folder ${folderName} was created with id ${currentFolderId}`);
        }
        if (currentFolderId === undefined) {
            return Promise.reject(`The (sub)folder ${folderName} couldn't be located nor created (Full path: ${options.path}. Query: ${q})`);
        }
        parentId = currentFolderId;
    }
    core.info(`Returning ${parentId} for ${pathStructure}`);
    return parentId;
}
//#endregion

module.exports = {
    login, createDriveApi, list, upload, update, folder
}