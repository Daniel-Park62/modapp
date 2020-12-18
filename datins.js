"use strict";
const DEVNUM = 54 ;
const SSNUM = 36 ;
const TAGPORT = 1502;
const DEVPORT = 1503;
const MAXTAGS = 30 ; // 보관할 갯수 이 갯수가 초과되면 오래된것부터 삭제

const express    = require('express');
const app        = express();
app.use(express.json()) ;

const mysql_dbc = require('./db/db_con')();
let con = mysql_dbc.init();
mysql_dbc.test_open(con);
con.isconn = true ;

require('date-utils');

let moteinfo = require('./api/moteinfo');
let apinfo = require('./api/apinfo');
let rdata = new Uint16Array(DEVNUM) ;
let MEAS = 5;

//let GWIP = process.argv[2] || "192.168.8.98" ;
let GWIP = process.env.GWIP || "172.16.162.135" ;
let port = process.env.RESTPORT || 9977 ;
console.info( "GateWay :" + GWIP);

const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();


app.get('/', (req, res) => {
  res.send('<h2>(주)다윈아이씨티 : Posco 온도 Monitoring 입니다  </h2>\n');
//  console.info(req.query) ;
  if (req.query.meas != null)  MEAS = req.query.meas ;
  console.info('time interval :'+ MEAS);
 });

function getMeasure() {
  con.query("SELECT measure FROM MOTECONFIG LIMIT 1",
    (err, dt) => {
      if (err) MEAS = 5 ;
      else   MEAS = dt[0].measure ;
      console.info('time interval :'+ MEAS);
//      resetTimer( MEAS) ;
  });
}

// Server
let motestatus = {"sensorNo": 1, "mac":"", "act" : 0, "descript": "INS" , "batt" : 3.299, "seq": 1 } ;
for (let i=1; i<=DEVNUM; i++) {
  motestatus.sensorNo = i;
  motestatus.seq = i;
  con.query('INSERT INTO motestatus SET ?', motestatus , (err, res) => { ; }
  );
}

con.query( ' delete from motehist where tm < DATE_ADD( now() , interval -2 month)',
        (err,res) => { if(err) console.log(err);  } ) ;

app.listen(port, function(){
  console.log('listening on port:' + port);
});

function getDevs() {
  if (! con.isconn ) {
    con = mysql_dbc.init();
    mysql_dbc.test_open(con);
    con.isconn = true ;
  }
  const cli_dev = new ModbusRTU();
  cli_dev.connectTCP(GWIP, { port: DEVPORT })
  .then( async () => {
      let vincr = (DEVNUM*6 > 100) ? 100 : DEVNUM*6 ;
      let rapdev = [] ;
      cli_dev.setID(1);
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
      for (let i=0; i < rapdev.length ; i += 6) {
//        if ( rapdev[i] == 0) continue ;
        let d = (Math.floor( i / 6) + 1);
        if (d > DEVNUM) break ;
        let vmac = (rapdev[i] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+1] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+1] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+2] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+2] >>>8).toString(16).padStart(2,'0') + ':'
                 + (rapdev[i+3] & 255).toString(16).padStart(2,'0') +':' + (rapdev[i+3] >>>8).toString(16).padStart(2,'0') ;
        let vbatt = rapdev[i+5] / 1000 ;
        let motestatus = {"seq": d, "mac":vmac, "act" : rapdev[i+4], "batt" : vbatt  };
        // console.log(motestatus) ;
        if (vbatt >= 0)
        con.query('UPDATE motestatus SET MAC = ?, ACT = ? , BATT = ?  where seq = ?',[motestatus.mac, motestatus.act, motestatus.batt, d],
         (err, res) => { if (err) console.error("UPDATE motestatus 1 ", err); }
        );
        if (vbatt < 3.5 && vbatt > 0 ) {
          con.query('UPDATE motestatus SET lowtm = now(), lowval = ? where seq = ? and lowval is null',[ motestatus.batt, d],
           (err, res) => { if (err) console.error("UPDATE motestatus 2", err); }
          );
        }

      }
  })
  .catch((e) => {
    console.error(DEVPORT , " port conn error");
    console.info(e);
  });

}

function insTemp() {
  getDevs() ;
  let rtags = new Uint16Array(SSNUM) ;
      client.close();
  client.connectTCP(GWIP, { port: TAGPORT })
  .then( async () => {
    client.setID(1);

    client.readInputRegisters(1, SSNUM)
      .then( function(d) {
          rtags = new Uint16Array(d.data);
      })
      .catch(function(e) {
              console.error("read register error");
              console.info(e); });

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
      con.query( ' delete from moteinfo where tm < (select x.tm from (select tm from moteinfo order by tm desc limit 25000,1) x )',
              (err,res) => { if(err) console.log(err); } ) ;
      devs = ( devs > motes.length ? motes.length : devs );
      let motearr = new Array() ;
      let seq = 0 ;
      for (let i=0; i < devs ; i += 6) {
        seq++ ;
//        if ( motes[i] == 0) continue ;
        let t = rtags[seq - 1] / 100.0;
        if (isNaN(t)) t = 0.0;

        let v = MEAS;
//        if(motes[i+1]  != 2) v = 9999 ;
//        client.writeRegister(i+3, v) ;

        motearr.push(  [ motes[i],   motes[i+1], motes[i+2], motes[i+3],  motes[i+4],  motes[i+5], tm, t, seq ] ) ;
        con.query('UPDATE motestatus SET sensorNo = ? where seq = ?',[motes[i], seq],
         (err, res) => { if(err) console.log(err); }
       );

      }

      if ( motearr.length > 0 ) {
          con.query('INSERT INTO moteinfo (sensorNo, act,measure, stand, loc, chock ,  tm, temp, seq  ) values ?', [motearr],
           (err, res) => { if(err) console.log(err); }
          );

          con.query('INSERT INTO motehist (id, sensorNo, act,measure, stand, loc, chock , temp, tm, seq) \
                     select id, sensorNo, act,measure, stand, loc, chock , temp, tm, seq from moteinfo where tm = ?', [tm],
           (err, res) => { if(err) console.log(err); }
          );
      }
      con.query('UPDATE lastime SET lastm = ? where id = 1', [ tm ],
       (err, res) => {
                        if(err) {
                          console.log("update lastime :"+ err);
                          con.end() ;
                          con.isconn = false ;
                        }
                    }
      );

//      client.close();

  })
  .catch((e) => {
    console.error(TAGPORT , " port conn error");
    console.info(e);
  });
}

getMeasure()  ;
main_loop();

async function main_loop() {
  let tm1 = new Date() ;
  await insTemp();
  let tm2 = new Date() ;
  let delay = MEAS * 1000 - (tm2 - tm1) - 10 ;
  setTimeout( main_loop,  delay) ;
}

process.on('uncaughtException', function (err) {
	//예상치 못한 예외 처리
	console.error('uncaughtException 발생 : ' + err.stack);
  con.end() ;
  con.isconn = false ;
});
