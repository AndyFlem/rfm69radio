// **********************************************************************************
// 
// Test RFM69 Radio.
//                                                       
// **********************************************************************************

#include <RFM69.h>              // https://www.github.com/lowpowerlab/rfm69
#include <RFM69_ATC.h>          // https://www.github.com/lowpowerlab/rfm69
#include <SPI.h>                // Included with Arduino IDE
#include <ArduinoJson.h>        // https://arduinojson.org/d
//#include <Adafruit_SleepyDog.h> // https://github.com/adafruit/Adafruit_SleepyDog
 
// Node and network config
#define NODEID        2    // The ID of this node (must be different for every node on network)
#define NETWORKID     100  // The network ID

// Are you using the RFM69 Wing? Uncomment if you are.
//#define USING_RFM69_WING 

// The transmision frequency of the baord. Change as needed.
#define FREQUENCY       RF69_915MHZ

// Uncomment if this board is the RFM69HW/HCW not the RFM69W/CW
#define IS_RFM69HW_HCW

// Serial board rate - just used to print debug messages
#define SERIAL_BAUD   115200

// Board and radio specific config - You should not need to edit

    #define RF69_RESET    2
    #define RF69_SPI_CS   4
    #define RF69_IRQ_PIN  3
    #define RF69_IRQ_NUM  digitalPinToInterrupt(RF69_IRQ_PIN) 


RFM69 radio(RF69_SPI_CS, RF69_IRQ_PIN, false, RF69_IRQ_NUM);

// Setup
void setup() {
  Serial.begin(115200);
  // Reset the radio
  resetRadio();
  // Initialize the radio
  
  radio.initialize(FREQUENCY, NODEID, NETWORKID);
  //radio.encrypt("0123456789abcdef");
  radio.promiscuous(true);
  #ifdef IS_RFM69HW_HCW
    radio.setHighPower(); //must include this only for RFM69HW/HCW!
  #endif
}

// Main loop
unsigned long previousMillis = 0;
const long sendInterval = 3000;
void loop() {

    // Receive
    if (radio.receiveDone()) {
    Serial.print('[');Serial.print(radio.SENDERID);Serial.print("] ");
    Serial.print((char*)radio.DATA);
    Serial.print("   [RX_RSSI:");Serial.print(radio.RSSI);Serial.print("]");
    Serial.println();
      if (radio.ACKRequested()) { radio.sendACK(radio.SENDERID); }
      delay(100);
    }


    // Send     
    unsigned long currentMillis = millis();
    if (currentMillis - previousMillis >= sendInterval) {
      previousMillis = currentMillis;
  
      if (Serial) Serial.println("Sending");
      char payload[5];
      String(millis(), DEC).toCharArray(payload,5);
      if (radio.sendWithRetry(1, payload, sizeof(payload), 3, 200)) {
        if (Serial) Serial.println("ACK received");
      } else {
        if (Serial) Serial.println("No ACK");
      }
    }
}

// Reset the Radio
void resetRadio() {
  if (Serial) Serial.print("Resetting radio...");
  pinMode(RF69_RESET, OUTPUT);
  digitalWrite(RF69_RESET, HIGH);
  delay(20);
  digitalWrite(RF69_RESET, LOW);
  delay(500);
}
