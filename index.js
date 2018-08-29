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
var nodemailer = require('nodemailer');
var mandrillTransport = require('nodemailer-mandrill-transport');


const fireStoreCollection = 'Vessel2';// stores data of pre-order products
const NotifyPreOrder = 'preOrderCustomer';// stores all customer data who want to opt in for notification
const app = express();
const shopifyApiPublicKey = process.env.SHOPIFY_API_PUBLIC_KEY;
const shopifyApiSecretKey = process.env.SHOPIFY_API_SECRET_KEY;
const scopes = 'write_products';
const appUrl = 'https://e6e7dd12.ngrok.io';

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
    
    res.send(shopData.data.shop)

  } catch(err) {
    console.log(err)
    res.status(500).send('something went wrong')
  }
    
});


//Firebase
app.get('/getData', async (req, res) => {
getOutOfStock().then(function(value) {
    res.send(value)
});
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

app.get('/getAllCustomersSheets', cors(), function(req, res){//shows all customers email on spreadsheet
authorize(content,readAllCustomers).then(function(value) {//value is an array
    res.send(value);
});
});

app.get('/QuerySheetsByVID', cors(), function(req, res){//shows all customers' email by vID
  var variantID = req.query.id;// url must contain ?id=12333123
  authorize(content,readAllCustomers).then(function(value) {//value is an array
    var final_array = [];
    for(var i = 0; i < value.length; i++){
        if(value[i][2] == variantID){
            final_array.push(value[i])
        }
    }
    res.send(final_array);//displays information of customers with a specific id
});
});

app.post('/cleanSheets', cors(), function(req, res){//shows all customers email on spreadsheet
    authorize(content,deleteCustomers);
    res.send("Customers Cleaned");
});

//shopify cleans results to firebase cloudstore
app.post('/updateSpreadSheet', cors(), function(req, res){
    authorize(content,autoAppend);
  res.send("PreOrder SpreadSheet updated successfully")
});

app.post('/updatePreOrderCustomers', cors(), function(req, res){//posts new customer to firebase
    newCustomer(req.body.email,req.body.url);
    writePreOrderCustomer(req.body.email,req.body.url,req.body.variantID);
    authorize(content,autoAppend);//automatically adds customer to spreadsheet
  res.send("Added Successfully");
});

app.post('/blankETA', cors(), function(req, res){//posts new customer to firebase
    requireETA(req.body.product);
});



app.post('/autoAddPreOrderProducts', cors(), function(req, res){//posts all out of stock products to firebase
  autoAddVariant(req.body.prodID,req.body.varID,req.body.inventory,req.body.title);    
  res.send("Added Successfully");
});


app.post('/cartCheckMsg', cors(), function(req, res){//posts all out of stock products to firebase
  remindMsg(req.body.prodID,req.body.varID);    
  res.send("Updated Successfully");
});

app.get('/checkOutOfStock', async (req, res) => {
//passing multiple params  ?param1=value1&param2=value2&param3=value3
var prodID = String(req.query.pid);//
checkOutOfStock(prodID).then(function(value) {
    res.send(value);
});
});

app.post('/removeInStock', cors(), function(req, res){//posts all out of stock products to firebase
  removeInStock(req.body.prodID,req.body.varID); 
  removeProductsWithInventory();
  res.send("Updated Successfully");
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

function addVariant(pID,ETA,vID,inventory){//manual
    
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
            available: [true],
        };
    var setDoc = db.collection(fireStoreCollection).doc(pID_array[i]).set(obj);
    }
}

function autoAddVariant(prodID,varID,inventory,title){//automatic add from theme.js from those that are currently out of stock
var vRef = db.collection(fireStoreCollection).doc(prodID);
var getDoc = vRef.get()
    .then(doc => {
      if (doc.exists) {//productID is already there
        var arrayCheck = [];//checks if Variant ID is in database
        arrayCheck = doc.data().vid;
        if(arrayCheck.includes(varID) == false){   
        var obj = {//object that will be inside the array
            pid: doc.data().pid,
            vid: doc.data().vid,
            msg: "",//blank so then we can email vessel to let them know
            qty: doc.data().qty,
            available: doc.data().available,
            name: doc.data().name,
        };
          obj.available.push(false);
          obj.vid.push(varID);
          obj.qty.push(inventory);
          obj.name.push(title);
    db.collection(fireStoreCollection).doc(prodID).set(obj);
        }

      } else {//productID isn't there
    var obj = {//object that will be inside the array
            pid: prodID,
            vid: [varID],
            msg: "",//blank so then we can email vessel to let them know
            qty: [inventory],
            available: [false],
            name: [title],
        };
    db.collection(fireStoreCollection).doc(prodID).set(obj);
      }
    })
    .catch(err => {
      console.log('Error getting document', err);
    });
}



async function getVariantRequireMsg(){//get all variants that need msgs
var vRef = db.collection(fireStoreCollection);
var resultArray = new Array();// stores all the variants
return new Promise(function(resolve, reject) {
    vRef.get()
    .then(snapshot => {
      snapshot.forEach(doc => {
          for(var i = 0; i < doc.data().available.length; i++){
            if(doc.data().available[i] == false){// only pushes false available
            resultArray.push(doc.data().name[i]);//need to change to variant name
            }
          }
      });
        resolve(resultArray);
    })
    .catch(err => {
      console.log('Error getting documents', err);
    });
});

}


async function setAllAvailableFalse(){//sets all available to true after messaging
var vRef = db.collection(fireStoreCollection);
    vRef.get()
    .then(snapshot => {
      snapshot.forEach(doc => {
          var fArray = [];
          for(var i = 0; i < doc.data().available.length; i++){
            fArray.push(true);
          }
          vRef.doc(doc.id).update({ available: fArray});
      });
    })
    .catch(err => {
      console.log('Error getting documents', err);
    });
}

function remindMsg(prodID,varID){//sets the product's available to false to remind vessel to update the message
var vRef = db.collection(fireStoreCollection).doc(prodID);
    vRef.get()
    .then(doc => {
      if (!doc.exists) {
        console.log('No such document!');
      } else {//document exists
        var availArray = []; //all available array
        availArray = doc.data().available;
        var indexOfVar = doc.data().vid.indexOf(varID);//index of the variantID
        availArray[indexOfVar] = false;
        vRef.update({ available: availArray});//updates the array if ETA message is still not updated
      }
    })
    .catch(err => {
      console.log('Error getting document', err);
    });
  
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
            available: index.data().available,
        };
        result_array.push(obj);
    } 
    return result_array;
}

//function for processing and returning which variant id's are out of stock 
async function getOutOfStock(){
    var vRef = db.collection(fireStoreCollection);
var resultArray = new Array();// stores all the variants
return new Promise(function(resolve, reject) {
    vRef.get()
    .then(snapshot => {
      snapshot.forEach(doc => {
          for(var i = 0; i < doc.data().vid.length; i++){
              if(doc.data().qty[i] < 1){
                resultArray.push(doc.data().vid[i]);
              }
          }
      });
        resolve(resultArray);
    })
    .catch(err => {
      console.log('Error getting documents', err);
    });
});
}



async function checkOutOfStock(prodID){//checks if varID is in database
var cityRef = db.collection(fireStoreCollection).doc(prodID);
return new Promise(function(resolve, reject) {
    cityRef.get()
    .then(doc => {
      if (!doc.exists) {
        resolve([]);
        console.log('No such document!');
      } else {
        resolve(doc.data().vid);
        console.log('Document data:', doc.data().vid);
      }
    })
    .catch(err => {
      console.log('Error getting document', err);
    });
});
}

async function removeProducts(){//completely wipes out out all of the data for a hard pre-order reset
    var vRef = db.collection(fireStoreCollection);  //collection name
    var allproducts = await vRef.get();//asynch
    for(index of allproducts.docs){
        var deleteDoc = vRef.doc(index.id).delete();
    }     
}


async function removeProductsWithInventory(){//completely wipes out out all of the data for a hard pre-order reset
    var vRef = db.collection(fireStoreCollection);  //collection name
    vRef.get()//asynch
    .then(snapshot => {
      snapshot.forEach(doc => {
          obj = doc.data();
        if(doc.data().qty.length == 1){
            if(doc.data().qty[0] != "0"){
                vRef.doc(doc.id).delete();
            }
        }
        else{//element is longer than 1
        obj = doc.data();
        var i = doc.data().qty.length;
            while (i--) {
            if (doc.data().qty[i] != "0") { 
             obj.name.splice(i, 1);
             obj.available.splice(i, 1);
             obj.vid.splice(i, 1);
             obj.qty.splice(i, 1);
             vRef.doc(doc.id).set(obj);
             if(i == 0 && doc.data().qty.length == 1){
                vRef.doc(doc.id).delete();
             }
            } 
        }
      }
      });
    })
    .catch(err => {
      console.log('Error getting documents', err);
    });

}



async function removeInStock(prodID,varID){//removess products that are in stock only if the inventory_quantity is greater than 0
    var pRef = db.collection(fireStoreCollection);  //collection name
    var query = pRef.doc(prodID);//query
    
    query.get().then(function(doc) {
  if (doc.exists) {//success
    var obj = doc.data(); //sets obj equal to the data obj
    const index = obj.vid.indexOf(varID);//finds index of varID
    obj.qty[index] = "0";
    console.log(obj);
    }
    }).catch(function(error) {
  console.log("Error getting document:", error);
    });
    
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
        var emptyArray = [];
        emptyArray.push(customer_email);
     var data = {
    email: emptyArray,
    productURL: url,
    vid: variantID,
    notified: "false" //customer hasn't been notified
     };

    }
    else{//success and email_array contains all the emails
        var email_array = result;
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
    }).catch(function(error) {
  console.log("Error getting document:", error);
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
            pRef.doc(doc.data().vid).set(updatedData); //updates customers to notified
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

async function deleteNotifiedCustomer(){
    var pRef = db.collection(NotifyPreOrder);  //collection name
    pRef.get()//asynch
    .then(snapshot => {
      snapshot.forEach(doc => {
          if(doc.data().notified == "true"){//customer was notified
              pRef.doc(doc.id).delete();
          }
      });
    })
    .catch(err => {
      console.log('Error getting documents', err);
    });    
}


////////google spreadsheet functions///////


// If modifying these scopes, delete credentials.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.

var content =
{"installed":{"client_id":process.env.sheet_client_id,"project_id":process.env.sheet_project_id,"auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://www.googleapis.com/oauth2/v3/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_secret":process.env.sheet_client_secret,"redirect_uris":["urn:ietf:wg:oauth:2.0:oob","http://localhost"]}};

function authorize(credentials,func) {//synchronous authentication
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  var token = fs.readFileSync(TOKEN_PATH);
      oAuth2Client.setCredentials(JSON.parse(token));
      return func(oAuth2Client);
    
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
async function appendData(auth) {//appends data from firebase to spreadsheet
    
  //first get Data from firebase
var array = await readPreOrderCustomer();// array will be empty if customers have already have been updated
if(array.length == 0){
    return; // no data needs to be written
}

var emailArray = [];
var pURLArray = [];
var variantIDArray = [];
    
for(var i = 0; i < array.length; i++){
    if(array[i].email.constructor === Array){// it is an array
    emailArray.push(array[i].email); //stores an array inside array if need be
    }else{
        var temp = [];
        temp.push(array[i].email);
        emailArray.push(temp);
    }
    pURLArray.push(array[i].productURL);
    variantIDArray.push(array[i].vid);
}        

  var sheets = google.sheets('v4');
  var tempValue = [];
  for(var ind = 0; ind < emailArray.length; ind++){
    for(var ind2 = 0; ind2 < emailArray[ind].length; ind2++){// if email array contains an array
        tempValue.push([emailArray[ind][ind2], pURLArray[ind], variantIDArray[ind]]);
        }
  }
  sheets.spreadsheets.values.update({
    auth: auth,
    spreadsheetId: '1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk',
    range: 'A2', //Change Sheet1 if your worksheet's name is something else
    valueInputOption: "USER_ENTERED",
    resource: {
     values: tempValue
    }
  }, (err, response) => {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    } else {
        console.log("Appended");
    }
  });
  
  
}
//Appends Data to SpreadSHeet Automatically
async function autoAppend(auth) {//appends data from firebase to spreadsheet
    
//Get current date
var today = new Date();
var dd = today.getDate();
var mm = today.getMonth()+1; //January is 0!
var yyyy = today.getFullYear();

if(dd<10) {
    dd = '0'+dd
} 

if(mm<10) {
    mm = '0'+mm
} 

today = mm + '/' + dd + '/' + yyyy;//current date 
  //first get Data from firebase
var array = await readPreOrderCustomer();// array will be empty if customers have already have been updated
if(array.length == 0){
    return; // no data needs to be written
}

var emailArray = [];
var pURLArray = [];
var variantIDArray = [];
    
for(var i = 0; i < array.length; i++){
    if(array[i].email.constructor === Array){// it is an array
    emailArray.push(array[i].email); //stores an array inside array if need be
    }else{
        var temp = [];
        temp.push(array[i].email);
        emailArray.push(temp);
    }
    pURLArray.push(array[i].productURL);
    variantIDArray.push(array[i].vid);
}        
  
  var sheets = google.sheets('v4');
  var tempValue = [];
  for(var ind = 0; ind < emailArray.length; ind++){
    for(var ind2 = 0; ind2 < emailArray[ind].length; ind2++){// if email array contains an array
        tempValue.push([emailArray[ind][ind2], pURLArray[ind], variantIDArray[ind],today,"No"]);
        }
  }
  sheets.spreadsheets.values.append({
    auth: auth,
    spreadsheetId: '1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk',
    range: 'Sheet1', //Change Sheet1 if your worksheet's name is something else
    valueInputOption: "USER_ENTERED",
    resource: {
     values: tempValue
    }
  }, (err, response) => {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    } else {
        console.log("Appended");
    }
  });
  
 
}


async function readAllCustomers(auth) {//reads all customers from google sheet
  var result_array = [];
  const sheets = google.sheets({version: 'v4', auth});
    result_array = await new Promise(function(resolve, reject) {
  sheets.spreadsheets.values.get({
    spreadsheetId: '1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk',
    range: 'Sheet1',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const rows = res.data.values;
    resolve(rows);
    if (rows.length) {
      // Print columns A and E, which correspond to indices 0 and 4.
      rows.map((row) => {
        //console.log(`${row[0]}, ${row[1]},${row[2]}`);
      });
    } else {
      console.log('No data found.');
    }
  });
});
    return(result_array); //returns an json of spreadsheet
}

function deleteCustomers(auth) {//reads all customers from google sheet
  const sheets = google.sheets({version: 'v4', auth});
    
    sheets.spreadsheets.values.get({
    spreadsheetId: '1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk',
    range: 'Sheet1',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const rows = res.data.values;
    var blank = [] 
    for(var i = 0; i < (rows.length - 1); i++){
        blank.push(["","",""]);
    sheets.spreadsheets.values.update({//update spreadsheet with blanks
    auth: auth,
    spreadsheetId: '1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk',
    range: 'A2', //Change Sheet1 if your worksheet's name is something else
    valueInputOption: "USER_ENTERED",
    resource: {
     values: blank
    }
  }, (err, response) => {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    } else {
        console.log("Deleted!");
    }
  });
    }
    if (rows.length) {//rows.length - 1 corresponds to number of rows
      
      rows.map((row) => {
        //console.log(`${row[0]}, ${row[1]},${row[2]}`);
      });
    } else {
      console.log('No data found.');
    }
  });
  
}

////////////////Function for mailer/////////////
function vesselMandrill(receiver, message) {
    
    
    var transport = nodemailer.createTransport(mandrillTransport({
        auth: {
            apiKey: process.env.MANDRILL_API
        }
    }));

    transport.sendMail({
        from   : 'info@vesselbags.com',
        html   : message,
        subject: 'Vessel Products That Require ETA Messages https://docs.google.com/spreadsheets/d/1zYG_NnKzf7wvDwXlVu_0STYWSF9w2Y1FoO-Zf1Gwfhk/edit?usp=sharing',//link to spreadsheet
        to     : receiver
    }, function (err, info) {
        if (err) {
            console.error(err);
        } else {
            console.log(info);
        }
    });
}

////////////////Function for mailer/////////////
function requireETA(message) {
    
    
    var transport = nodemailer.createTransport(mandrillTransport({
        auth: {
            apiKey: process.env.MANDRILL_API
        }
    }));

    transport.sendMail({
        from   : 'info@vesselbags.com',
        html   : message,
        subject: 'Vessel Products That Require ETA Messages',//link to spreadsheet
        to     : "info@vesselbags.com"
    }, function (err, info) {
        if (err) {
            console.error(err);
        } else {
            console.log(info);
        }
    });
}

function newCustomer(receiver, message) {
var fs = require('fs'); //Filesystem    
var handlebars = require('handlebars');
var content = fs.readFileSync("./emailTemplate/newCustomer.html","utf-8");
var template = handlebars.compile(content);
var replacements = {
    customer:receiver,
    text:message
}; 
var htmlToSend = template(replacements);    
    
    
    var transport = nodemailer.createTransport(mandrillTransport({
        auth: {
            apiKey: process.env.MANDRILL_API
        }
    }));

    transport.sendMail({
        from   : 'info@vesselbags.com',
        html   : htmlToSend,
        subject: 'New Customer ' + receiver +  ' signed up for a pre-order product notification',
        to     : 'info@vesselbags.com'//update
    }, function (err, info) {
        if (err) {
            console.error(err);
        } else {
            console.log(info);
        }
    });
}
///CHRON FUNCTION that sends emails every day
var schedule = require('node-schedule');
 
var j = schedule.scheduleJob('* * * * 3', function(){//executes task once a week
getVariantRequireMsg().then(function(value) {
    var html = "";
    for(var i = 0; i < value.length; i++){
    html += "<ul>" + value[i] + "</ul>";
    }
    if(value.length > 0){
    vesselMandrill("info@vesselbags.com", html);
    setAllAvailableFalse();//sets all pre-order products availability to true so next time email is sent out, there won't be duplicates
    }
});  
});


//chron for deleting all customers who have been notified
schedule.scheduleJob('* 3 * * *', function(){//executes task once an hour
deleteNotifiedCustomer();
});



////////////////Function for mailChimp/////////////
const Mailchimp = require('mailchimp-api-v3'); // node js mailchimp wrapper library
app.post('/signup', cors(), function (req, res) {
  const api_key = process.env.MAILCHIMP_API; // api key -
  const list_id = process.env.LIST_KEY; // list id
  const mailchimp = new Mailchimp(api_key); // create MailChimp instance
  mailchimp.post(`lists/${list_id}`, { members: [{ // send a post request to create new subscription to the list
      email_address:req.body.email,
      status: "subscribed"
  }]
  }).then((reslut) => {
    return console.log(reslut);
  }).catch((error) => {
    return console.log(error);
  });
});


