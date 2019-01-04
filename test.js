/* eslint-disable no-console */
'use strict'; 
const RFM69 = require('./index');

const rfm69 = new RFM69();

rfm69.initialize({
  address: 5,
  encryptionKey: '0123456789abcdef', 
  verbose:false, 
  initializedCallback: initializedCallback,
  packetReceivedCallback: packetReceivedCallback,
}); 

function initializedCallback() {
  console.log('Initialized');
  rfm69.readTemperature((temp) => {
    console.log('Temp: ', temp);
    rfm69.calibrateRadio();
  });

  setInterval(function() {
    const toAddress=2;
    console.log(`Sending packet to address ${toAddress}`);
    rfm69.send({
      toAddress: toAddress, payload: 'hello', attempts: 1, requireAck: false, ackCallback: function(err, res) {
        if (err){
          console.log(err)
        }else
        {
          console.log("Packet send successful on attempt:",res);
        }
      },
    });
  }, 1000);

  
  setTimeout(
    function() {rfm69.broadcast('Broadcast!!',function(){
      console.log("Sent broadcast")
    });}
    ,2000
  );
  /*
  setInterval(function() {
    const toAddress=2;
    console.log(`Sending packet to address ${toAddress}`);
    rfm69.send({
      toAddress: toAddress, payload: 'hello', ackCallback: function(err, res) {
        if (err){
          console.log(err)
        }else
        {
          console.log("Packet send successful on attempt:",res);
        }
      },
    });
  }, 4000);
  */
}

function packetReceivedCallback(packet) {
    console.log(`Packet received from peer address '${packet.senderAddress}': ${packet.payloadString}`);
}

process.on('SIGINT', () => {
  rfm69.shutdown();
});
