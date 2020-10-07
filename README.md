
# glob-to-drive

GitHub Action that takes a glob, finds files and uploads them to Google Drive

## Usage

This Action requires two tokens that the user has to generate: The credentials and the refresh token.

The _credentials_ can be obtained by creating an OAuth Client ID (type has to be "Web application") in the GoogleAPIs page [here](https://console.developers.google.com/apis/credentials). Also, the file `login.js` uses `http://localhost:3000/oauth2callback` as redirect URI, so the "Authorized redirect URIs" can only have one value and it has to be that URL. Clicking the download button will download a json file with the credentials

The next step is getting the _refresh token_ by running the file `login.js`, which will open the google log in page. After logging in, a file `token.json` will be created.

The content of those two files should be uploaded as secrets to the repo, then they can be used as the example shows

## Example

```yml
  - name: Upload to Google Drive
    uses: PeronTheDuck/glob-to-drive@v3
    with:
        # Required, used to find files
        glob: "**/*.pdf"
        # Optional, if left empty, the files are uploaded to My Drive
        uploadTo: ${{ secrets.DRIVE_FOLDER_ID }}
        # Both required, tells Google that you are authorized to use Drive
        credentials: ${{ secrets.CREDENTIALS }}
        token: ${{ secrets.TOKEN }}
        # Optional, Google Drive will try to guess it if left empty
        mimeType: "application/pdf"
```
