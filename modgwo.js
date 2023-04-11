"use strict";
const DEVNUM = 54 ;
const SSNUM = 36 ;
const TAGPORT = 1502;
const DEVPORT = 1503;
const MAXTAGS = 30 ; // 보관할 갯수 이 갯수가 초과되면 오래된것부터 삭제

const fs = require('fs');
const net = require('net');
const express    = require('express');
const app        = express();
app.use(express.json()) ;

require('date-utils');

let rdata = new Uint16Array(DEVNUM) ;
let MEAS = 5;
let buffarr = new Array() ;

let GWIP = process.env.GWIP || "127.0.0.1" ;
let port = process.env.RESTPORT || 9988 ;
console.info( "GateWay :" + GWIP);

const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();


app.get('/', (req, res) => {
  res.send('<h2>(주)다윈아이씨티 : Posco 온도 Monitoring 입니다 ( /measure ) </h2>\n');
 });

app.post('/measure', function(req, res){
   var result = {  };
  if(!req.body["active"] || !req.body["wait"]){
      result["success"] = 0;
      result["error"] = "invalid request";
      res.json(result);
      return;
  }
  console.info("time interval modify :" + req.body.active) ;
  MEAS = req.body.active ;
  result = {"success": 1};
  res.json(result);

  fs.writeFile('./measure.dat', req.body.active ,'utf8', function(error, data){
    if (error) {console.log("write error :"+ error)};
  });

//  resetTimer(req.body.active) ;
  motemac.forEach( (item, index) => {
    if (item.act > 0) sensor_push(item.Mac, item.act) ;
  });
});

function getMeasure() {
  fs.readFile('./measure.dat', 'utf8', function(error, data){
    if (error) {return 5}
    else MEAS = data ;
  });
}

// Server
let motemac = new Array(DEVNUM);

for (let i=1; i<= SSNUM; i++) {
  motemac[i] =  { "Mac":"X","act":-1}  ;
}
getDevs() ;

app.listen(port, function(){
  console.log('listening on port:' + port);
});

function getDevs() {
  const cli_dev = new ModbusRTU();
  cli_dev.connectTCP(GWIP, { port: DEVPORT })
  .then( async () => {
      let vincr = (SSNUM*6 > 100) ? 100 : SSNUM*6 ;
      let rapdev = [] ;
      cli_dev.setID(1);
      for (let ii = 1; ii < SSNUM*6 ; ii += vincr) {
        await cli_dev.readInputRegisters(ii, vincr)
        .then ( (d) => { rapdev = rapdev.concat(d.data) ;})
        .catch( (e) => {
          console.error( "apdev register read error");
          console.info(e);
        });
      }
      cli_dev.close();
//      let rapdev = new Uint16Array(rdev);
      for (let i=0; i < rapdev.length ; i += 6) {
//        if ( rapdev[i] == 0) continue ;
        let d = (Math.floor( i / 6) + 1);
        let vmac = (rapdev[i] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+1] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+1] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+2] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+2] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+3] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+3] >>>8).toString(16).padStart(2,'0') ;

        if ( d <= SSNUM) motemac[d].Mac = vmac.replace(/:/gi,'');
      }
  })
  .catch((e) => {
    console.error(GWIP,DEVPORT , " port conn error");
    console.info(e);
  });

}


function insTemp() {

  client.close();
  client.connectTCP(GWIP, { port: TAGPORT })
  .then( async () => {
    client.setID(1);

      const today = new Date();
      const tm = today.toFormat('YYYY-MM-DD HH24:MI:SS');
      let devs = SSNUM*6;
      let vincr = (devs > 100) ? 100 : devs ;
      let motes = [] ;

    //  async () => {
        for (let ii = 1; ii < devs ; ii += vincr) {
          await  client.readHoldingRegisters(ii, vincr)
          .then ( (d) => { motes = motes.concat(d.data) ;  })
          .catch( (e) => {
            console.error( "Holding register read error");
            console.info(e);
          });
        }
    //      let rapdev = new Uint16Array(rdev);

      devs = ( devs > motes.length ? motes.length : devs );
      let ix = 0 ;
      for (let i=0; i < devs ; i += 6) {
        ix++ ;
        if ( ix <= SSNUM && motemac[ix] != null ) {
          if ( motemac[ix].act != -1 && motemac[ix].act != motes[i+1] ) {
            sensor_push(motemac[ix].Mac,  motes[i+1] ) ;
            const dt = new Date(2020, 0, 16) ;
            if ( new Date() < dt )
              fs.appendFile('./change.log', ix + " => " + item.Mac + " " + item.act + " " + Date() + "\n" ,'utf8', function(error, data){
                if (error) {console.log("change write error :"+ error)};
              });
          }
          motemac[ix].act = motes[i+1] ;
        }

        let v = MEAS;
        if(motes[i+1]  != 2) v = 9999 ;
        client.writeRegister(i+3, v) ;

      }
  })
  .catch((e) => {
    console.error(TAGPORT , " port conn error");
    console.info(e);
  });
}

getMeasure()  ;
main_loop();
reset_loop() ;

setTimeout( recheck_sensor, 3000 ) ;

async function main_loop() {
  let tm1 = new Date() ;
  await insTemp();
  let tm2 = new Date() ;
  let delay = MEAS * 1000 - (tm2 - tm1);
  setTimeout( main_loop,  delay) ;
}

function reset_loop() {
   let buff = buffarr.shift() ;
   if (buff != undefined) sensor_set(buff) ;
   setTimeout(reset_loop,6000);
}

function recheck_sensor() {
  motemac.forEach( (item, index) => {
    if (item.act >= 0) {
      sensor_push(item.Mac, item.act) ;
    }
  });
  setTimeout(recheck_sensor, 200000) ;
}

process.on('uncaughtException', function (err) {
	//예상치 못한 예외 처리
	console.error('uncaughtException 발생 : ' + err.stack);
});

function sensor_push(mac, act ) {
	//    if (act == -1) return ;
		if (mac.indexOf("00000000") != -1) return;
    let idx = buffarr.findIndex( item => item.toString('hex').substr(0,16) == mac ) ;
    if (idx > -1) buffarr.splice(idx,1) ;
    let buf1 = Buffer.alloc(14);
    buf1.writeInt32LE(act == 2 ? MEAS : 9999,10);
    buf1.write(mac,'hex');
    buf1[8] = 1;
    buf1[9] = 4;
    buffarr.push(buf1) ;
	console.info(" push :" + buf1.toString('hex') );
}

function sensor_set( buf1 ) {

    let socket = net.connect( {port : 40000}, () => {
//      console.info(buf1.toString('hex'));
      socket.setNoDelay(true);
      try {
        let ret = socket.write(buf1) ;
      } catch (e) {
        console.log("socket write error :"+ e);
        buffarr.push(buf1) ;
      }
    } );
    socket.on('data', function (data) {
        console.log(" *** Server return data : " + data.toString('hex'), Date() );
        // if (data[8] != 0)          buffarr.push(buf1) ;
        socket.end();
//	socket.end();
    });
    socket.on('error', function (err) {
        console.error(" *** Error : ", Date() ,buf1.toString('hex') + " : " + JSON.stringify(err));
        buffarr.push(buf1) ;
    });

}

function getConn(connName){

    let option = {
        host: GWIP ,
        port: 40000
    }

    // Create TCP client.
    let client = net.createConnection(option, function () {
//        console.log('Connection name : ' + connName);
        console.log('Connection local address : ' + this.localAddress + ":" + this.localPort);
        console.log('Connection remote address : ' + this.remoteAddress + ":" + this.remotePort);
    });

//    client.setTimeout(1000);
//    client.setEncoding('ascii');
    client.setNoDelay(true);

    // When receive server send back data.
    client.on('data', function (data) {
        console.log('*** Server return data : ' + data);
    });

    // When connection disconnected.
    client.on('end',function () {
        console.log('Client socket disconnect. ');
    });

    // client.on('timeout', function () {
    //     console.log('Client connection timeout. ');
    // });

    client.on('error', function (err) {
        console.error(connName + "\n" + JSON.stringify(err));
    });

    return client;
}
