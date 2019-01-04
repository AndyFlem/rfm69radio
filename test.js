var RFM69=require('./index');
var rfm69=new RFM69();

rfm69.initialize({
	address: 5,
	encryptionKey:"0123456789abcdef",
	initializedCallback: initializedCallback,
	dataReceivedCallback: dataReceivedCallback
}); 

function initializedCallback() {
	console.log('Initialized'); 
	rfm69.readTemperature((temp)=>{console.log("Temp: ",temp)});
	
	setInterval(function(){
		rfm69.send({toAddress:2,payload:"hello",ackCallback: function(err,res) {
			console.log(err,res); 
		}});
	},5000);
}

function dataReceivedCallback(err,msg){  
	if (err)
	{
		console.error('Error:',err)
	} else {
		console.log('Data:', msg); 
	} 
	
} 
 
process.on('SIGINT', () => {
	rfm69.shutdown(); 
});
 