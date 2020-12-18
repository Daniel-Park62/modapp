"use strict";
const DEVNUM = 2 ;
const TAGNUM = 100 ;
const TAGPORT = 1502;
const DEVPORT = 1503;
const MAXTAGS = 30 ; // 보관할 갯수 이 갯수가 초과되면 오래된것부터 삭제

const path = require('path');
const express    = require('express');
const app        = express();
const bodyParser = require('body-parser');
require('date-utils');

let apinfo = require('./api/apinfo');
let tags = require('./api/tags');
let rdata = new Uint16Array(DEVNUM*TAGNUM*2) ;

let GWIP = process.argv[2] || "192.168.8.100" ;
let port = process.argv[3] || 9988;

const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(function (req, res, next) { //1
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'content-type');
  next();
});

// API

app.get('/', (req, res) => {
  res.send('<h2>(주)다윈아이씨티 : 태그 정보를 보내주는 API입니다 (/tags, /apdevs) </h2>\n');
 });

 app.get('/tags', (req, res) => {
   console.log("request :" + req.originalUrl + " " + req.ip) ;
   res.json(tags)  ;
   if (client.isOpen) tags = [];
 });

 app.get('/apdevs', (req, res) => {
   console.log("request :" + req.originalUrl + " " + req.ip) ;
   res.json(getDevs())  ;
 });

// Server

app.listen(port, function(){
  console.log('listening on port:' + port);
});

function getDevs() {
  const cli_dev = new ModbusRTU();
  cli_dev.connectTCP(GWIP, { port: DEVPORT })
  .then( async () => {
      let vincr = (DEVNUM*6 > 100) ? 100 : DEVNUM*6 ;
      let rapdev = [] ;
      for (let ii = 1; ii < DEVNUM*6 ; ii += vincr) {
        await cli_dev.readInputRegisters(ii, vincr)
        .then ( (d) => { rapdev = rapdev.concat(d.data) ;})
        .catch( (e) => {
          console.error( "apdev register read error");
          console.info(e);
        });
      }
      cli_dev.close();
//      let rapdev = new Uint16Array(rdev);
      apinfo = [];
      for (let i=0; i < rapdev.length ; i += 6) {
        let d = (Math.floor( i / 6) + 1);
        let vmac = (rapdev[i] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+1] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+1] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+2] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+2] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+3] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+3] >>>8).toString(16).padStart(2,'0') ;
        let vbatt = rapdev[i+5] * 100 / 3600 ;
        if (vbatt > 100) vbatt = 100 ;
        apinfo.push({"apdev": d, "mac":vmac, "act" : rapdev[i+4], "batt" : vbatt.toFixed(2)  });
      }
  })
  .catch((e) => {
    console.error(DEVPORT , " port conn error");
    console.info(e);
  });
  return apinfo ;

}

function checkError(e) {
    if(e.errno && networkErrors.includes(e.errno)) {
        console.log("we have to reconnect");

        // close port
        client.close();

        // re open client
        client = new ModbusRTU();
        connect() ;
    }
}

// open connection to a serial port
function connect() {

    // if client already open, just run
    if (client.isOpen) {
        return;
    }

    // if client closed, open a new connection
    client.connectTCP(GWIP, { port: TAGPORT })
        .then(function() {
            console.log("Connected");
            tags = [];
          })
        .catch(function(e) {
            console.error(TAGPORT , " port conn error");
            console.warn(e);
          });
}

function getTags() {

// open connection to a tcp line
  if (! client.isOpen)  connect() ;

  client.setID(1);
  if ( client.isOpen) {

    readReg().then ( () => {
      creTags() ;
    }) ;
  } else {
      const today = new Date();
      tags[0].tm = today.toFormat('YYYY-MM-DD HH24:MI:SS');
  }
}

async function readReg() {
//    rdata = new Uint16Array();
    for (let ii = 1 ; ii < DEVNUM*TAGNUM*2 ; ii += 100) {
      await client.readInputRegisters(ii, 100)
        .then( function(d) {
            let rtags = new Uint16Array(d.data);
            for (let r=0; r < rtags.length;r++) {
              rdata[ii+r-1] = rtags[r] ;
            }
        })
        .catch(function(e) {
                console.error("read register error");
                console.info(e); });
     }  // for

}

function creTags() {
    const today = new Date();
    const tm = today.toFormat('YYYY-MM-DD HH24:MI:SS');

    let taglist = new Array();
    let aplist = new Array();
    let vbatt = 0, vrssi = 0, vsos = 0 ,vd = 1;

    for (let x = 0; ; x += 2) {
      let d = (Math.floor(x / (TAGNUM*2)) + 1)  ;
      if(vd != d && taglist.length || x>=rdata.length) {
        if ( apinfo.filter( item => item.apdev == vd )[0].act == 2 ) {
          aplist.push({apdev:vd, tags:taglist}) ;
        }
        taglist = [];
      }
      if (x>=rdata.length) {
        tags.push({"tm":tm, apdevs:aplist});
        break ;
      }
      vd = d;
      if (! rdata[x] ) continue ;
      vrssi = rdata[x+1] >>> 8 ;
      vsos  = (rdata[x+1] >>> 7) & 0x01 ;
      vbatt = rdata[x+1] & 0x7f ;
      taglist.push({tagid:rdata[x], rssi:-vrssi, sos:vsos, batt: vbatt }) ;
      rdata[x] = 0;
    }

    if (tags.length >= MAXTAGS) {
      const result = tags.shift() ;
      console.log("삭제: " + result.tm );
    }
}

let timerId = null;
getTags() ;
getDevs() ;

timerId = setInterval(getTags, 5000);
