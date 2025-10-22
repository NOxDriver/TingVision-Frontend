#!/bin/bash

# Install dependencies for Client
if [ -d "Client" ]; then
  echo "Installing Client dependencies..."
  cd Client
  npm install
  cd ..
else
  echo "Client directory not found."
fi

# Install dependencies for Firebase Functions
if [ -d "Server/functions" ]; then
  echo "Installing Firebase Functions dependencies..."
  cd Server/functions
  npm install
  cd ../..
else
  echo "Server/functions directory not found."
fi

