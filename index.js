const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 3000
const dotenv = require('dotenv').config();
const crypto = require('crypto');
const cookie = require('cookie');
const nonce = require('nonce')();
const querystring = require('querystring');
const axios = require('axios');
var cors = require('cors');
var bodyParser = require('body-parser');
var admin = require("firebase-admin");
const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');


const fireStoreCollection = 'Vessel2';// stores data of pre-order products
const NotifyPreOrder = 'preOrderCustomer';// stores all customer data who want to opt in for notification
const app = express();
const shopifyApiPublicKey = process.env.SHOPIFY_API_PUBLIC_KEY;
const shopifyApiSecretKey = process.env.SHOPIFY_API_SECRET_KEY;
const scopes = 'write_products';
const appUrl = 'https://50aec6e3.ngrok.io';

//body parser
app.use(bodyParser.urlencoded({ extended: false })) 

app.use(bodyParser.json());


//enable CORS 
app.use(cors())



///////////// Helper Functions /////////////

const buildRedirectUri = () => `${appUrl}/shopify/callback`;

const buildInstallUrl = (shop, state, redirectUri) => `https://${shop}/admin/oauth/authorize?client_id=${shopifyApiPublicKey}&scope=${scopes}&state=${state}&redirect_uri=${redirectUri}`;

const buildAccessTokenRequestUrl = (shop) => `https://${shop}/admin/oauth/access_token`;

const buildShopDataRequestUrl = (shop) => `https://${shop}/admin/products.json`;

const generateEncryptedHash = (params) => crypto.createHmac('sha256', shopifyApiSecretKey).update(params).digest('hex');

const fetchAccessToken = async (shop, data) => await axios(buildAccessTokenRequestUrl(shop), {
  method: 'POST',
  data
});

const fetchShopData = async (shop, accessToken) => await axios(buildShopDataRequestUrl(shop), {
  method: 'GET',
  headers: {
    'X-Shopify-Access-Token': accessToken
  }
});


///////////// Route Handlers /////////////

app//homepage
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .get('/', (req, res) => res.render('pages/index'))


app.get('/shopify', (req, res) => {
  const shop = req.query.shop;

  if (!shop) { return res.status(400).send('no shop')}

  const state = nonce();

  const installShopUrl = buildInstallUrl(shop, state, buildRedirectUri())

  res.cookie('state', state) // should be encrypted in production
  res.redirect(installShopUrl);
});
/*
//shopify verification
app.get('/shopify/callback', (req,res) => {
    const {shop,hmac,code,state} = req.query;
    const stateCookie = cookie.parse(req.headers.cookie).state;
    
    if(state !== stateCookie){
        return res.status(403).send('Request origin cannot be verified');
    }
    if(shop && hmac && code){
        const map = Object.assign({},req.query);
        delete map['hmac'];
        const message = querystring.stringify(map);
        const generatedHash = crypto.createHmac('sha256',shopifyApiSecretKey)
        .update(message).digest('hex');
        
        if(generatedHash !== hmac){
            return res.status(400).send('HMAC validation failed');
        }
        const accessTokenRequestUrl = 'https://' + shop + '/admin/oauth/access_token';
        const accessTokenPayLoad = {
            client_id:shopifyApiPublicKey,
            client_secret:shopifyApiSecretKey,
            code
        };
        
        request.post(accessTokenRequestUrl,{json: accessTokenPayLoad})
        .then((accessTokenResponse) => {
            const accessToken = accessTokenResponse.access_token;
            
            const apiRequestUrl = 'https://' + shop + '/admin/products.json?ids=715109564476';// GET URL
            const filter = apiRequestUrl + '?ids=';//filter
            const apiRequestHeader = {
                'X-Shopify-Access-Token': accessToken
            };
            request.get(apiRequestUrl,{headers: apiRequestHeader})
            .then((apiResponse) =>{
                console.log(apiResponse)
                res.end(apiResponse);
            })
            .catch((error) => {
                res.status(error.statusCode).send(error.error.error_description);
            });
        })
        .catch((error) =>{
            res.status(error.statusCode).send(error.error.error_description);
        });
    }else{
        res.status(400).send('Required Parameters missing');
    }
});
*/
app.get('/shopify/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  const stateCookie = cookie.parse(req.headers.cookie).state;

  if (state !== stateCookie) { return res.status(403).send('Cannot be verified')}

  const { hmac, ...params } = req.query
  const queryParams = querystring.stringify(params)
  const hash = generateEncryptedHash(queryParams)

  if (hash !== hmac) { return res.status(400).send('HMAC validation failed')}

  try {
    const data = {
      client_id: shopifyApiPublicKey,
      client_secret: shopifyApiSecretKey,
      code
    };
    const tokenResponse = await fetchAccessToken(shop, data)

    const { access_token } = tokenResponse.data

    const shopData = await fetchShopData(shop, access_token)
    console.log(shopData.data.shop);
    res.send(shopData.data.shop)

  } catch(err) {
    console.log(err)
    res.status(500).send('something went wrong')
  }
    
});


//Firebase
app.get('/getData', async (req, res) => {
  var result_array = await getOutOfStock();
  res.send(result_array)
});


//shopify posts results to firebase cloudstore
app.post('/postData', cors(), function(req, res){
    addVariant(req.body.pID,req.body.ETA,req.body.vID,req.body.inventory);// add to database
  res.send("Database updated successfully")
});

//shopify cleans results to firebase cloudstore
app.post('/clean', cors(), function(req, res){
    removeProducts();// add to database
  res.send("Database updated successfully")
});

app.get('/Sheets', cors(), function(req, res){
  authorize((content), appendData);
  res.send("Wrote Successfully")
});


///////////// Start the Server /////////////

app.listen(PORT, () => console.log(`listening on port ${PORT}`));
admin.initializeApp({
  credential: admin.credential.cert({
  "type": "service_account",
  "project_id": "preorder-inventory",
  "private_key_id": process.env.private_key_id,
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC6w+jr51muRD/+\nRxDX9ViVlZ/9G7oQX+QaYk+T2qvdbBolv7FIJMvMedpBDZJIlVLdh59UNww2K/H8\nD+NlSKTU1xDZzkO+eMDHsa/ZFmHqX+f7O9f5y+uWMVWG6Gd3LnSqWdTCcgY4H/G7\nXGUQUj8oojGLaaMvhwiqRwrZUj4rC24u46grpJkM8Kfi4FsJPLlZeqS24G/ZGzap\n7RRhYF+1hdbWFv0WB0J8XlsqpdiR8+9ZVEAfPHUTTBQWNpM/ld6VQ9FWhDrrqnUX\nVgTggxXZYpL3Pdv4v2U5yYAnG2Tko/WWVfx4VEBkIYAfPaOyBP7Q+7qyro24/K4b\nWrrLC8unAgMBAAECggEAQ0u9PWd+zobEIjz8Kjy6/ydLXzni6OyMdh9PekC0ZdQC\ndfClEhBEKPkNNhyMRcAcfDtWo1M0gL6D8qXM851h21llNn4Wteav3CS/7rKcdIW7\nQrEVCOq8CEHdhf9u7KheHFXDDo9kg0urYC4SMnfYTy1mOcxGIyV+b1Cq7ZSvVvWo\nv+a1jUnmClM83+eZRjwdxJoB45nYmVuQFjdR5Lp/8jpPYEnf3Ul4HRnQiPdejDVl\nOD+boflIuKMTezVaJNVEiqTQBwD1xZTsh9+4sypCKkIxEwiutrkTqh40lbSuwQ7E\nluZENopL7hZlZSrIyR8qXGh5W6BmZJpxVYW90iFipQKBgQDul3rmIRr/PaKGQlUz\nHbhplcBDFXdxI/obqfpbtVy8GPg9ejHJ+Dh4lQQfm4TaUYxwTD+JY8KgvvIvoxRv\nMJCIocXGOT7jb1zUOgauQkZNd4EwtunFvKFoxAQzbUlTCoWt7l90Nxnqx2TKm4wU\n89WS3BqWWqAplLYS8llGmvHHuwKBgQDIZGSS7VU7FJobXtUWll0SwtNFneEAGpIA\ni5Qflqi0YTldbK9bcUR3dAopOsyipsOCIj0UrubG/aHj55TjCfsXsYLs4wM3HrI9\nl5Lhkj4XRUiwA+pTp4ZMK5lw6dTiI5o11mKG7GjMZAUdatgzOzk40zyhRxOksXUQ\npGwCfxXfBQKBgAuKZDVxcH7cGlpoJvrb+ymQRsZ36VkdpmFkLWn2MdAfXRKMMJBW\nY1Th0Fs/CIQO4b4k0gXxP17LHafUOY7PSI5zVL+r0TDrGBBj5iLTrdbdavBSSKh5\n4UzR/moGZT+RCLpLB271o1lJ38Q1FeeFi9UYtGiFZa3dNZlhA5R4ti01AoGAOWiB\nY5I4Y5eQWpz9YN4sxc4opn4HUndKMnvKMI6BwENGItybFBBL9Ai7THp623H4+pQC\neaVtmb5ZnaffgHeAhpYlEuYqKqVRnNGKk7LItPP1Ue+dNt/8Wl/3MmDayvo2GIxV\nZ5/cmglhab8NNwgVaZEignWRTBJGnkDsbH6p7l0CgYBu0YfsUFToxam70IxVF9kq\nNMnVlLZIot6OVD6BCEeuMNI3ohZ3oJFLZAT7ngerjh0c48mrWz2qDVXYAuq28wcU\nySUmK4p6WlVUIAsvQGXRIABDiOfWkuBMWW+6hGb/DgBP9M4pVDVgr0Mmcc0wfypX\nezB5fhz8oiX/oBaI/ZK4bA==\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-7tt73@preorder-inventory.iam.gserviceaccount.com",
  "client_id": process.env.client_id,
  "auth_uri": process.env.auth_uri,
  "token_uri": "https://accounts.google.com/o/oauth2/token",
  "auth_provider_x509_cert_url": process.env.cert_url,
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-7tt73%40preorder-inventory.iam.gserviceaccount.com",
  }),
  databaseURL: process.env.database_url
});
const db = admin.firestore();


//Functions for Firebase///////

function addVariant(pID,ETA,vID,inventory){
    
  Array.prototype.clean = function(deleteValue) {
  for (var i = 0; i < this.length; i++) {
    if (this[i] == deleteValue) {         
      this.splice(i, 1);
      i--;
    }
  }
  return this;
  };
    var vRef = db.collection(fireStoreCollection);  //collection name
    var pID_array = pID.split("*"); //splits based on SHOPIFY for each product
    var ETA_array = ETA.split("*"); //splits ETA dates based on shopify for each product added
    var vID_array = vID.split("|"); //split so each product has an array of variant ids
    var inventory_array = inventory.split("|");//split so each product has an array of inventory
    var final_inventory = [];
    var final_vID = [];

    for(var i = 0; i < vID_array.length;i++){
        final_inventory.push(inventory_array[i].split("*"));
        final_vID.push(vID_array[i].split("*"));
    }
    //Filters out blanks
    for(var i = 0; i < final_vID.length;i++){//remove blanks
        final_inventory[i].clean('');
        final_vID[i].clean('');
    }
    final_inventory.pop();//removes last blank
    final_vID.pop();//removes last blank
    pID_array.pop();
    ETA_array.pop();

    for(var i = 0; i < final_vID.length; i++){
        var obj = {//object that will be inside the array
            pid: pID_array[i],
            vid: final_vID[i],
            msg: ETA_array[i],
            qty: final_inventory[i],
        };
    var setDoc = db.collection(fireStoreCollection).doc(pID_array[i]).set(obj);
    }
}



async function getDatabase(){
    var result_array = new Array();
    var vRef = db.collection(fireStoreCollection);  //collection name
    var allproducts = await vRef.get();//asynch
    for(index of allproducts.docs){
        var obj = {//object that will be inside the array
            pid: index.id,
            vid: index.data().vid,
            msg: index.data().msg,
            qty: index.data().qty,
        };
        result_array.push(obj);
    } 
    return result_array;
}

//function for processing and returning which variant id's are out of stock 
async function getOutOfStock(){
    var result_array = new Array();
    var vRef = db.collection(fireStoreCollection);  //collection name
    var allproducts = await vRef.get();//asynch
    for(index of allproducts.docs){
        for(vIndex = 0; vIndex< index.data().qty.length;vIndex++){
            if(index.data().qty[vIndex] < 1){//checks if product is out of stock
            var obj = {//object that will be inside the array
                pid: index.id,
                vid: index.data().vid[vIndex],
                msg: index.data().msg,
                qty: index.data().qty[vIndex],
                };
                result_array.push(obj);
            }
        }
    } 
    return result_array;
}

async function removeProducts(){//completely wipes out out all of the data for a hard pre-order reset
    var vRef = db.collection(fireStoreCollection);  //collection name
    var allproducts = await vRef.get();//asynch
    for(index of allproducts.docs){
        var deleteDoc = vRef.doc(index.id).delete();
    }     
}

async function getPreOrderCustomers(variantID){// 
    var pRef = db.collection(NotifyPreOrder);  //collection name
    var allCustomers = await pRef.doc(variantID);
    
    return new Promise(function(resolve, reject) {//promise 
    allCustomers.get().then(function(doc) {
  if (doc.exists) {//success
      resolve(doc.data().email);
  } else {// variant ID is not in system
    console.log("No such variantID in the current Database!");
    resolve(undefined);
    }
    }).catch(function(error) {
  console.log("Error getting document:", error);
    });
});
    
}

function writePreOrderCustomer(customer_email,url,variantID){// writes to the database key is variantID
getPreOrderCustomers(variantID).then(function(result) {
    if(result == undefined){//variant is not in system
     var data = {
    email: customer_email,
    productURL: url,
    vid: variantID,
    notified: "false" //customer hasn't been notified
     };

    }
    else{//success and email_array contains all the emails
        var email_array = [];
        if(result.length > 1){//array is more than 1
        email_array = result;    
        }else{//array only contains 1 email       
        email_array.push(result); 
        }
        email_array.push(customer_email);//add current customer email to email list
         var data = {
            email: email_array,
            productURL: url,
            vid: variantID,
            notified: "false" //customer hasn't been notified
        };
        
    }
            // Add a new document in collection 
    var setDoc = db.collection(NotifyPreOrder).doc(variantID).set(data);
});
    
}


async function readPreOrderCustomer(){//google firebase get all customer data to write to mailchimp
    var pRef = db.collection(NotifyPreOrder);  //collection name
    var finalArray = [];
    finalArray = await new Promise(function(resolve, reject) {//promise that is later returned
    var preOrderArray = [];
    pRef.get()
    .then(snapshot => {
      snapshot.forEach(doc => {
        if(doc.data().notified == "false"){//customer hasn't been updated to mailchimp
            var data = {
            email: doc.data().email,
            productURL: doc.data().productURL,
            vid: doc.data().vid
        };
            var updatedData = {// set notified to true
            email: doc.data().email,
            productURL: doc.data().productURL,
            vid: doc.data().vid,
            notified: "true",
            }
            //pRef.doc(doc.data().vid).set(updatedData); //updates customers to notified
            preOrderArray.push(data);
        }else{//customer has been updated to mailchimp
            console.log("customers have been updated to mailchimp already");
        }
      });
    resolve(Promise.all(preOrderArray));
    })
    .catch(err => {
      console.log('Error getting documents', err);
    });
});
    return finalArray;//array of objects
}







////////google spreadsheet functions///////


// If modifying these scopes, delete credentials.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.

var content =
{"installed":{"client_id":process.env.sheet_client_id,"project_id":process.env.sheet_project_id,"auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://www.googleapis.com/oauth2/v3/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_secret":process.env.sheet_client_secret,"redirect_uris":["urn:ietf:wg:oauth:2.0:oob","http://localhost"]}};




/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return callback(err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Prints the names and majors of students in a sample spreadsheet:
 * @see https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 */


//Writes to SpreadSheet
async function appendData(auth) {
    
  //first get Data from firebase
var array = await readPreOrderCustomer();// array will be empty if customers have already have been updated
console.log(array);
    /*
  var sheets = google.sheets('v4');
  sheets.spreadsheets.values.append({
    auth: auth,
    spreadsheetId: '1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk',
    range: 'Sheet1', //Change Sheet1 if your worksheet's name is something else
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [ ["Void", "Canvas", "Website"], ["Paul", "Shan", "Human"] ]
    }
  }, (err, response) => {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    } else {
        console.log("Appended");
    }
  });
  */
}
appendData();


