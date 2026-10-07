import mongoose from 'mongoose';
import { getMongoConfig } from './env.js';

let connectionPromise;
export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connectionPromise) {
    let config;
    try { config = getMongoConfig(); }
    catch (error) { console.error('[enquiry] Mongo configuration missing or invalid: MONGODB_URI'); throw error; }
    connectionPromise = mongoose.connect(config.uri, {
      maxPoolSize: 5, serverSelectionTimeoutMS: 5000, socketTimeoutMS: 5000,
      bufferCommands: false, autoIndex: false,
    }).then(connection => {
      if (process.env.NODE_ENV === 'development') console.info('[enquiry] Mongo connection succeeded');
      return connection;
    }).catch(error => {
      if (process.env.NODE_ENV === 'development') console.error('[enquiry] Mongo connection failed');
      connectionPromise = undefined;
      throw error;
    });
  }
  const connection = await connectionPromise;
  connectionPromise = undefined;
  return connection;
}
