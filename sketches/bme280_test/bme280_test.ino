#include <RFM69.h>              // https://www.github.com/lowpowerlab/rfm69
#include <SPI.h>                // Included with Arduino IDE


// BME280
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

/************ Radio Setup ***************/
// Node and network config
#define NODEID        2    // The ID of this node (must be different for every node on network)
#define NETWORKID     100  // The network ID

// The transmision frequency of the baord. Change as needed.
#define FREQUENCY       RF69_915MHZ

// Uncomment if this board is the RFM69HW/HCW not the RFM69W/CW
#define IS_RFM69HW_HCW

// Serial board rate - just used to print debug messages
#define SERIAL_BAUD   115200

// Board and radio specific config - You should not need to edit

#define RF_RESET    2
#define RF_SPI_CS   4
#define RF_IRQ_PIN  3
#define RF_IRQ_NUM  digitalPinToInterrupt(RF_IRQ_PIN) 

RFM69 radio(RF_SPI_CS, RF_IRQ_PIN, false, RF_IRQ_NUM);

/************ BME Setup ***************/
#define BME_SCK 13
#define BME_MISO 12
#define BME_MOSI 11
#define BME_CS 10
#define SEALEVELPRESSURE_HPA (1013.25)

Adafruit_BME280 bme; // I2C


int16_t packetnum = 0;  // packet counter, we increment per xmission

unsigned long delayTime;

void setupBME() {
    Serial.println(F("BME280 test"));

    bool status;
    
    // default settings
    // (you can also pass in a Wire library object like &Wire2)
    status = bme.begin();  
    if (!status) {
        Serial.println("Could not find a valid BME280 sensor, check wiring!");
        while (1);
    }
}

void setupRadio() 
{

  // Reset the radio
  if (Serial) Serial.print("Resetting radio...");
  pinMode(RF_RESET, OUTPUT);
  digitalWrite(RF_RESET, HIGH);
  delay(20);
  digitalWrite(RF_RESET, LOW);
  delay(500);

  // Initialize the radio
  radio.initialize(FREQUENCY, NODEID, NETWORKID);
  //radio.encrypt("0123456789abcdef");
  radio.promiscuous(true);
  #ifdef IS_RFM69HW_HCW
    radio.setHighPower(); //must include this only for RFM69HW/HCW!
  #endif
}


void setup() {
  Serial.begin(115200);

  setupRadio();
  setupBME();

  delayTime = 1000;

  Serial.println();

}

void loop() {
  delay(delayTime);  // Wait 1 second between transmits, could also 'sleep' here!

  char Pstr[10];
  char Fstr[10];
  char Hstr[10];
  double F,P,H;
  char buffer[50];
  byte sendLen;

  P = bme.readPressure() / 100.0F;
  F = bme.readTemperature();
  H = bme.readHumidity();

  dtostrf(F, 3,2, Fstr);
  dtostrf(H, 3,2, Hstr);
  dtostrf(P, 3,2, Pstr);
  sprintf(buffer, "{\"T\":%s,\"H\":%s,\"P\":%s}", Fstr, Hstr, Pstr);
  Serial.println(buffer);
  sendLen = strlen(buffer);

  if (radio.sendWithRetry(1, buffer, sendLen, 3, 200)) {
    if (Serial) Serial.println("ACK received");
  } else {
    if (Serial) Serial.println("No ACK");
  }

}

