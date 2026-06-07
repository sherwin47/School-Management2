export const sendSMS = async (to: string, message: string): Promise<void> => {
  // Twilio integration wrapper
  console.log(`[SMS DISPATCH] To: ${to} | Message: ${message}`);
  // return twilioClient.messages.create({ body: message, from: TWILIO_NUMBER, to });
};
