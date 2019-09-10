const Web3 = require("web3");
const fs = require("fs");
const path = require('path');
const BigNumber = require('bignumber.js');
const solc4 = require('solc4');
const solc5 = require('solc5');

const rpcUrl = 'https://testnet2.matic.network';
const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
const gasPrice = BigNumber(0);
const chainId = 8995;

const senderPk = web3.utils.sha3("migrate" + web3.utils.randomHex(7));
const sender = web3.eth.accounts.privateKeyToAccount(senderPk).address;

const configFile = path.join(__dirname, "../") + 'matic.json';
const contractPath = path.join(__dirname, "../contracts/");
const solc4Input = {
    "ConversionRates.sol" : fs.readFileSync(contractPath + 'ConversionRates.sol', 'utf8'),
    "ExpectedRate.sol" : fs.readFileSync(contractPath + 'ExpectedRate.sol', 'utf8'),
    "FeeBurner.sol" : fs.readFileSync(contractPath + 'FeeBurner.sol', 'utf8'),
    "KyberNetwork.sol" : fs.readFileSync(contractPath + 'KyberNetwork.sol', 'utf8'),
    "KyberNetworkCrystal.sol" : fs.readFileSync(contractPath + 'KyberNetworkCrystal.sol', 'utf8'),
    "KyberNetworkProxy.sol" : fs.readFileSync(contractPath + 'KyberNetworkProxy.sol', 'utf8'),
    "KyberReserve.sol" : fs.readFileSync(contractPath + 'KyberReserve.sol', 'utf8')
};
const solc5Input = {
    language: 'Solidity',
    sources: {
        'KyberSwapLimitOrder.sol' : {
            content: fs.readFileSync(contractPath + 'KyberSwapLimitOrder.sol', 'utf8')
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': [ '*' ]
            }
        }
    }
};

async function sendTx(txObject) {
    const to = txObject._parent.options.address;
    const data = txObject.encodeABI();
    const from = sender;
    const gas = 5000000;
    const nonce = await web3.eth.getTransactionCount(sender);
    const tx = { from, to, nonce, data, gas, chainId, gasPrice };
    const signedTx = await web3.eth.accounts.signTransaction(tx, senderPk);
    return web3.eth.sendSignedTransaction(signedTx.rawTransaction, {from:sender});
}

async function deployContract(bytecode, abi, ctorArgs) {
    const contract = new web3.eth.Contract(abi);
    const deploy = contract.deploy({data:"0x" + bytecode, arguments: ctorArgs});
    const tx = await sendTx(deploy);
    contract.options.address = tx.contractAddress;
    return [tx.contractAddress, contract];
}

async function main() {
    console.log("Deploy from: ", sender);
    console.log("Private key: ", senderPk);

    console.log("Starting compilation");
    const solc4Output = await solc4.compile({ sources: solc4Input }, 1);
    const solc5Output = await JSON.parse(solc5.compile(JSON.stringify(solc5Input)));
    console.log("Finished compilation");

    let output = solc4Output.contracts["KyberNetworkCrystal.sol:KyberNetworkCrystal"];
    [kncAddress, kncContract] = await deployContract(output.bytecode, JSON.parse(output.interface), ['213398119754066550702706505', '1505455200', '1506232800', sender]);
    console.log("KyberNetworkCrystal: ", kncAddress);

    output = solc4Output.contracts["KyberNetworkProxy.sol:KyberNetworkProxy"];
    [proxyAddress, proxyContract] = await deployContract(output.bytecode, JSON.parse(output.interface), [sender]);
    console.log("KyberNetworkProxy: ", proxyAddress);

    output = solc4Output.contracts["KyberNetwork.sol:KyberNetwork"];
    [networkAddress, networkContract] = await deployContract(output.bytecode, JSON.parse(output.interface), [sender]);
    console.log("KyberNetwork: ", networkAddress);
 
    output = solc4Output.contracts["ExpectedRate.sol:ExpectedRate"];
    [expectedRateAddress, expectedRateContract] = await deployContract(output.bytecode, JSON.parse(output.interface), [networkAddress, kncAddress, sender]);
    console.log("ExpectedRate: ", expectedRateAddress);
    
    output = solc4Output.contracts["FeeBurner.sol:FeeBurner"];
    [feeBurnerAddress, feeBurnerContract] = await deployContract(output.bytecode, JSON.parse(output.interface), [sender, kncAddress, networkAddress, 307]);
    console.log("FeeBurner: ", feeBurnerAddress);
   
    output = solc4Output.contracts["ConversionRates.sol:ConversionRates"];
    [ratesAddress, ratesContract] = await deployContract(output.bytecode, JSON.parse(output.interface), [sender]);
    console.log("ConversionRates: ", ratesAddress);
    
    output = solc4Output.contracts["KyberReserve.sol:KyberReserve"];
    [reserveAddress, reserveContract] = await deployContract(output.bytecode, JSON.parse(output.interface), [networkAddress, ratesAddress, sender]);
    console.log("KyberReserve: ", reserveAddress);

    output = solc5Output.contracts['KyberSwapLimitOrder.sol']['KyberSwapLimitOrder'];
    [swapAddress, swapContract] = await deployContract(output.evm.bytecode.object, output.abi, [sender, proxyAddress]);
    console.log("KyberSwapLimitOrder: ", swapAddress);

    await sendTx(proxyContract.methods.setKyberNetworkContract(networkAddress));
    await sendTx(proxyContract.methods.transferAdminQuickly(sender));
    await sendTx(networkContract.methods.addOperator(sender));
    await sendTx(networkContract.methods.addReserve(reserveAddress, true));
    await sendTx(networkContract.methods.setExpectedRate(expectedRateAddress));
    await sendTx(networkContract.methods.setFeeBurner(feeBurnerAddress));
    await sendTx(networkContract.methods.setKyberProxy(proxyAddress));
    await sendTx(networkContract.methods.setEnable(true));
    await sendTx(expectedRateContract.methods.addOperator(sender));
    await sendTx(expectedRateContract.methods.setWorstCaseRateFactor(300));
    await sendTx(expectedRateContract.methods.setQuantityFactor(1));
    await sendTx(feeBurnerContract.methods.addOperator(sender));
    await sendTx(feeBurnerContract.methods.setReserveData(reserveAddress, 25, sender));
    await sendTx(feeBurnerContract.methods.setTaxInBps(1000));
    await sendTx(ratesContract.methods.addOperator(sender));
    await sendTx(ratesContract.methods.addToken(kncAddress));
    await sendTx(ratesContract.methods.setValidRateDurationInBlocks(24));
    await sendTx(ratesContract.methods.setReserveAddress(reserveAddress));
    await sendTx(ratesContract.methods.setTokenControlInfo(kncAddress, '1000000000000000', '2711997842670896021504', '3833713935933528080384'));
    await sendTx(ratesContract.methods.enableTokenTrade(kncAddress));
    await sendTx(ratesContract.methods.setQtyStepFunction(kncAddress, [0], [0], [0], [0]));
    await sendTx(ratesContract.methods.setImbalanceStepFunction(kncAddress, [0], [0], [0], [0]));

    let matic = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    matic.network = proxyAddress;
    matic.tokens.KNC.address = kncAddress;
    matic.reserve = reserveAddress;
    matic.kyberswapAddress = swapAddress;
    fs.writeFileSync(configFile, JSON.stringify(matic, null, 2));
}

main();