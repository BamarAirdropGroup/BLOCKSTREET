const fs = require('fs');


fs.readFile('wallets.json', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading wallets.json:', err);
    return;
  }

  try {
    
    const wallets = JSON.parse(data);

    
    const output = wallets
      .map((wallet, index) => `PRIVATE_KEY_${index + 1}=${wallet.privateKey}`)
      .join('\n');

    
    fs.writeFile('pkey.txt', output, (err) => {
      if (err) {
        console.error('Error writing to pkey.txt:', err);
        return;
      }
      console.log('Private keys saved to pkey.txt successfully');
    });
  } catch (parseErr) {
    console.error('Error parsing JSON:', parseErr);
  }
});
