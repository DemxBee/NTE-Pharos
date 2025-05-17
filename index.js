import blessed from "blessed";
import chalk from "chalk";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const RPC_URL = "https://testnet.dplabs-internal.com";
const WPHRS_ADDRESS = "0x76aaada469d23216be5f7c596fa25f282ff9b364";
const USDT_ADDRESS = "0xed59de2d7ad9c043442e381231ee3646fc3c2939";
const ROUTER_ADDRESS = "0x1a4de519154ae51200b0ad7c90f7fac75547888a";
const API_BASE_URL = "https://api.pharosnetwork.xyz";
const FAUCET_USDT_URL = "https://testnet-router.zenithswap.xyz/api/v1/faucet";
const CONFIG_FILE = "config.json";
const isDebug = false;

let walletInfo = {
  address: "N/A",
  balancePHRS: "0.00",
  balanceWPHRS: "0.00",
  balanceUSDT: "0.00",
  activeAccount: "N/A",
  cycleCount: 0,
  nextCycle: "N/A"
};
let transactionLogs = [];
let activityRunning = false;
let isCycleRunning = false;
let shouldStop = false;
let dailyActivityInterval = null;
let privateKeys = [];
let proxies = [];
let selectedWalletIndex = 0;
let loadingSpinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const borderBlinkColors = ["cyan", "blue", "magenta", "red", "yellow", "green"];
let borderBlinkIndex = 0;
let blinkCounter = 0;
let spinnerIndex = 0;
let nonceTracker = {};
let hasLoggedSleepInterrupt = false;
let accountJwts = {};
let isHeaderRendered = false;
一场 activeProcesses = 0;

let dailyActivityConfig = {
  swapRepetitions: 20, 
  sendPhrsRepetitions: 10 
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
  "function multicall(uint256 collectionAndSelfcalls, bytes[] data) public"
];

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const config = JSON.parse(data);
      dailyActivityConfig.swapRepetitions = Number(config.swapRepetitions) || 20;
      dailyActivityConfig.sendPhrsRepetitions = Number(config.sendPhrsRepetitions) || 10;
      addLog(`Loaded config: Auto Swap  = ${dailyActivityConfig.swapRepetitions}, Auto Send PHRS = ${dailyActivityConfig.sendPhrsRepetitions}`, "success");
    } else {
      addLog("No config file found, using default settings.", "info");
    }
  } catch (error) {
    addLog(`Failed to load config: ${error.message}, using default settings.`, "error");
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(dailyActivityConfig, null, 2));
    addLog("Configuration saved successfully.", "success");
  } catch (error) {
    addLog(`Failed to save config: ${error.message}`, "error");
  }
}

process.on("unhandledRejection", (reason, promise) => {
  addLog(`Unhandled Rejection at: ${promise}, reason: ${reason}`, "error");
});

process.on("uncaughtException", (error) => {
  addLog(`Uncaught Exception: ${error.message}\n${error.stack}`, "error");
  process.exit(1);
});

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type = "info") {
  if (type === "debug" && !isDebug) return;
  const timestamp = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  let coloredMessage;
  switch (type) {
    case "error":
      coloredMessage = chalk.red(message);
      break;
    case "success":
      coloredMessage = chalk.green(message);
      break;
    case "wait":
      coloredMessage = chalk.yellow(message);
      break;
    case "debug":
      coloredMessage = chalk.blue(message);
      break;
    default:
      coloredMessage = chalk.white(message);
  }
  transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
  updateLogs();
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function clearTransactionLogs() {
  transactionLogs = [];
  addLog("Transaction logs cleared.", "success");
  updateLogs();
}

function getApiHeaders(customHeaders = {}) {
  return {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Origin": "https://testnet.pharosnetwork.xyz",
    "Referer": "https://testnet.pharosnetwork.xyz/",
    ...customHeaders
  };
}

async function sleep(ms) {
  if (shouldStop) {
    if (!hasLoggedSleepInterrupt) {
      addLog("Process stopped successfully.", "info");
      hasLoggedSleepInterrupt = true;
    }
    return;
  }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);
      const checkStop = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timeout);
          clearInterval(checkStop);
          if (!hasLoggedSleepInterrupt) {
            addLog("Process stopped successfully.", "info");
            hasLoggedSleepInterrupt = true;
          }
          resolve();
        }
      }, 100);
    });
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1); 
  }
}

function loadPrivateKeys() {
  try {
    const data = fs.readFileSync("pk.txt", "utf8");
    privateKeys = data.split("\n").map(key => key.trim()).filter(key => key.match(/^(0x)?[0-9a-fA-F]{64}$/));
    if (privateKeys.length === 0) throw new Error("No valid private keys in pk.txt");
    addLog(`Loaded ${privateKeys.length} private keys from pk.txt`, "success");
  } catch (error) {
    addLog(`Failed to load private keys: ${error.message}`, "error");
    privateKeys = [];
  }
}

function loadProxies() {
  try {
    const data = fs.readFileSync("proxy.txt", "utf8");
    proxies = data.split("\n").map(proxy => proxy.trim()).filter(proxy => proxy);
    if (proxies.length === 0) throw new Error("No proxies found in proxy.txt");
    addLog(`Loaded ${proxies.length} proxies from proxy.txt`, "success");
  } catch (error) {
    addLog(`No proxy.txt found or failed to load, running without proxies: ${error.message}`, "warn");
    proxies = [];
  }
}

function loadWalletAddresses() {
  try {
    const data = fs.readFileSync("wallet.txt", "utf8");
    const addresses = data.split("\n").map(addr => addr.trim()).filter(addr => addr.match(/^0x[0-9a-fA-F]{40}$/));
    if (addresses.length === 0) throw new Error("No valid addresses in wallet.txt");
    addLog(`Loaded ${addresses.length} wallet addresses from wallet.txt`, "success");
    return addresses;
  } catch (error) {
    addLog(`No wallet.txt found or failed to load, skipping PHRS transfers: ${error.message}`, "warn");
    return [];
  }
}

function createAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  } else {
    return new HttpsProxyAgent(proxyUrl);
  }
}

function getProviderWithProxy(proxyUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const agent = createAgent(proxyUrl);
      const fetchOptions = agent ? { agent } : {};
      const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" }, { fetchOptions });
      return provider;
    } catch (error) {
      addLog(`Attempt ${attempt}/${maxRetries} failed to initialize provider: ${error.message}`, "error");
      if (attempt < maxRetries) sleep(2000);
    }
  }
  try {
    addLog(`Proxy failed, falling back to direct connection`, "warn");
    const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" });
    return provider;
  } catch (error) {
    addLog(`Fallback failed: ${error.message}`, "error");
    throw new Error("Failed to initialize provider after retries");
  }
}

function getProviderWithoutProxy() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" });
    return provider;
  } catch (error) {
    addLog(`Failed to initialize provider: ${error.message}`, "error");
    throw new Error("Failed to initialize provider");
  }
}

async function makeApiRequest(method, url, data, proxyUrl, customHeaders = {}, maxRetries = 3, retryDelay = 2000, useProxy = true) {
  activeProcesses++;
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const agent = useProxy && proxyUrl ? createAgent(proxyUrl) : null;
        const headers = getApiHeaders(customHeaders);
        const config = {
          method,
          url,
          data,
          headers,
          ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
          timeout: 10000
        };
        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        let errorMessage = `Attempt ${attempt}/${maxRetries} failed for API request to ${url}`;
        if (error.response) errorMessage += `: HTTP ${error.response.status} - ${JSON.stringify(error.response.data || error.response.statusText)}`;
        else if (error.request) errorMessage += `: No response received`;
        else errorMessage += `: ${error.message}`;
        addLog(errorMessage, "error");
        if (attempt < maxRetries) {
          addLog(`Retrying API request in ${retryDelay/1000} seconds...`, "wait");
          await sleep(retryDelay);
        }
      }
    }
  throw new Error(`Failed to make API request to ${url} after ${maxRetries} attempts: ${lastError.message}`);
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function updateWalletData() {
  const walletDataPromises = privateKeys.map(async (privateKey, i) => {
    try {
      const proxyUrl = proxies[i % proxies.length] || null;
      const provider = getProviderWithProxy(proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const [phrsBalance, balanceWPHRS, balanceUSDT] = await Promise.all([
        provider.getBalance(wallet.address).catch(() => 0),
        new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address).catch(() => 0),
        new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address).catch(() => 0)
      ]);
      const formattedEntry = `${i === selectedWalletIndex ? "→ " : "  "}${getShortAddress(wallet.address)}   ${Number(ethers.formatEther(phrsBalance)).toFixed(4).padEnd(8)} ${Number(ethers.formatEther(balanceWPHRS)).toFixed(2).padEnd(8)}${Number(ethers.formatEther(balanceUSDT)).toFixed(2).padEnd(8)}`;
      if (i === selectedWalletIndex) {
        walletInfo.address = wallet.address;
        walletInfo.activeAccount = `Account ${i + 1}`;
        walletInfo.balancePHRS = Number(ethers.formatEther(phrsBalance)).toFixed(4);
        walletInfo.balanceWPHRS = Number(ethers.formatEther(balanceWPHRS)).toFixed(2);
        walletInfo.balanceUSDT = Number(ethers.formatEther(balanceUSDT)).toFixed(2);
      }
      return formattedEntry;
    } catch (error) {
      addLog(`Failed to fetch wallet data for account #${i + 1}: ${error.message}`, "error");
      return `${i === selectedWalletIndex ? "→ " : "  "}N/A 0.00       0.00     0.00`;
    }
  });
  const walletData = await Promise.all(walletDataPromises);
  addLog("Wallet data updated.", "info");
  return walletData;
}

async function getNextNonce(provider, walletAddress) {
  if (shouldStop) {
    addLog("Nonce fetch stopped due to stop request.", "info");
    throw new Error("Process stopped");
  }
  try {
    const pendingNonce = await provider.getTransactionCount(walletAddress, "pending");
    const lastUsedNonce = nonceTracker[walletAddress] || pendingNonce - 1;
    const nextNonce = Math.max(pendingNonce, lastUsedNonce + 1);
    nonceTracker[walletAddress] = nextNonce;
    return nextNonce;
  } catch (error) {
    addLog(`Error fetching nonce for ${getShortAddress(walletAddress)}: ${error.message}`, "error");
    throw error;
  }
}

async function checkAndApproveToken(wallet, provider, tokenAddress, amount, tokenName, accountIndex, swapCount) {
  if (shouldStop) {
    addLog("Approval stopped due to stop request.", "info");
    return false;
  }
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const balance = await token.balanceOf(signer.address);
    if (balance < amount) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Insufficient ${tokenName} balance (${ethers.formatEther(balance)})`, "error");
      return false;
    }
    const allowance = await token.allowance(signer.address, ROUTER_ADDRESS);
    if (allowance < amount) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Approving ${tokenName}...`, "info");
      const nonce = await getNextNonce(provider, signer.address);
      const feeData = await provider.getFeeData();
      const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, {
        gasLimit: 300000,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
        nonce
      });
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Approval sent. Hash: ${getShortHash(tx.hash)}`, "success");
      await tx.wait();
    }
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Error approving ${tokenName}: ${error.message}`, "error");
    return false;
  }
}

async function getMulticallData(pair, amount, walletAddress) {
  if (shouldStop) {
    addLog("Multicall data generation stopped due to stop request.", "info");
    return [];
  }
  try {
    const decimals = pair.from === "WPHRS" ? 18 : 18;
    const amountStr = typeof amount === "string" ? amount : amount.toString();
    const scaledAmount = ethers.parseUnits(amountStr, decimals);
    let data;
    if (pair.from === "WPHRS" && pair.to === "USDT") {
      data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"],
        [
          WPHRS_ADDRESS,
          USDT_ADDRESS,
          500,
          walletAddress,
          scaledAmount,
          0,
          0
        ]
      );
      return [ethers.concat(["0x04e45aaf", data])];
    } else if (pair.from === "USDT" && pair.to === "WPHRS") {
      data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"],
        [
          USDT_ADDRESS,
          WPHRS_ADDRESS,
          500,
          walletAddress,
          scaledAmount,
          0,
          0
        ]
      );
      return [ethers.concat(["0x04e45aaf", data])];
    } else {
      addLog(`Invalid pair: ${pair.from} -> ${pair.to}`, "error");
      return [];
    }
  } catch (error) {
    addLog(`Failed to generate multicall data: ${error.message}`, "error");
    return [];
  }
}

async function executeDeposit(wallet, amountPHRs, accountIndex) {
  if (shouldStop) {
    addLog("Deposit stopped due to stop request.", "info");
    return false;
  }
  activeProcesses++;
  try {
    const provider = getProviderWithoutProxy();
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const balance = await provider.getBalance(signer.address);
    const amountWei = ethers.parseEther(amountPHRs.toString());
    if (balance < amountWei) {
      addLog(`Account ${accountIndex + 1}: Insufficient PHRs balance (${ethers.formatEther(balance)} PHRs)`, "error");
      return false;
    }
    addLog(`Account ${accountIndex + 1}: Executing deposit of ${amountPHRs} PHRs to wPHRs...`, "info");
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const tx = await signer.sendTransaction({
      to: WPHRS_ADDRESS,
      value: amountWei,
      data: "0xd0e30db0",
      gasLimit: 100000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
      nonce
    });
    addLog(`Account ${accountIndex + 1}: Deposit transaction sent. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1}: Deposit of ${amountPHRs} PHRs to wPHRs completed`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1}: Deposit failed: ${error.message}`, "error");
    return false;
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function loginAccount(wallet, proxyUrl, useProxy = true) {
  if (shouldStop) {
    addLog("Login stopped due to stop request.", "info");
    return false;
  }
  try {
    const message = "pharos";
    const signature = await wallet.signMessage(message);
    const loginUrl = `${API_BASE_URL}/user/login?address=${wallet.address}&signature=${signature}`;
    const loginResponse = await makeApiRequest("post", loginUrl, {}, proxyUrl, {}, 3, 2000, true);
    if (useProxy && proxyUrl) {
      addLog(`Account ${selectedWalletIndex + 1}: Using Proxy ${proxyUrl}`, "info");
    }
    if (loginResponse.code === 0) {
      accountJwts[wallet.address] = loginResponse.data.jwt;
      addLog(`Account ${getShortAddress(wallet.address)}: Logged in successfully.`, "success");
      return true;
    } else {
      addLog(`Account ${getShortAddress(wallet.address)}: Login failed: ${loginResponse.msg}`, "error");
      return false;
    }
  } catch (error) {
    addLog(`Account ${getShortAddress(wallet.address)}: Login error: ${error.message}`, "error");
    return false;
  }
}

async function claimFaucetPHRs() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog("Starting Auto Claim PHRS for all accounts.", "info");
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      const wallet = new ethers.Wallet(privateKeys[accountIndex]);
      addLog(`Processing claim for account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      if (!accountJwts[wallet.address]) {
        const loginSuccess = await loginAccount(wallet, proxyUrl);
        if (!loginSuccess) {
          addLog(`Account ${accountIndex + 1}: Skipping claim due to login failure.`, "error");
          continue;
        }
      }

      try {
        const statusUrl = `${API_BASE_URL}/faucet/status?address=${wallet.address}`;
        const statusResponse = await makeApiRequest(
          "get",
          statusUrl,
          null,
          proxyUrl,
          { "Authorization": `Bearer ${accountJwts[wallet.address]}` },
          3,
          2000,
          true
        );
        if (statusResponse.code === 0) {
          if (statusResponse.data.is_able_to_faucet) {
            const claimUrl = `${API_BASE_URL}/faucet/daily?address=${wallet.address}`;
            const claimResponse = await makeApiRequest(
              "post",
              claimUrl,
              {},
              proxyUrl,
              { "Authorization": `Bearer ${accountJwts[wallet.address]}` },
              3,
              2000,
              true
            );
            if (claimResponse.code === 0) {
              addLog(`Account ${accountIndex + 1}: PHRS faucet claimed successfully.`, "success");
            } else {
              addLog(`Account ${accountIndex + 1}: Failed to claim PHRS: ${claimResponse.msg}`, "error");
            }
          } else {
            const availableTime = statusResponse.data.avaliable_timestamp
              ? Math.round((statusResponse.data.avaliable_timestamp * 1000 - Date.now()) / (1000 * 60 * 60)) + " hours"
              : "unknown";
            addLog(`Account ${accountIndex + 1}: Already Claimed Today. Next claim available in ${availableTime}.`, "warn");
          }
        } else {
          addLog(`Account ${accountIndex + 1}: Failed to check faucet status: ${statusResponse.msg}`, "error");
        }
      } catch (error) {
        addLog(`Account ${accountIndex + 1}: Faucet status check error: ${error.message}`, "error");
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 5 seconds before next account...`, "wait");
        await sleep(5000);
      }
    }
    addLog("Auto Claim Faucet PHRS completed for all accounts.", "success");
  } catch (error) {
    addLog(`Auto Claim PHRs failed: ${error.message}`, "error");
  } finally {
    await updateWallets(); 
  }
}

async function claimFaucetUSDT() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog("Starting Auto Claim USDT for all accounts.", "info");
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      const wallet = new ethers.Wallet(privateKeys[accountIndex]);
      addLog(`Processing USDT claim for account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      try {
        const payload = {
          tokenAddress: USDT_ADDRESS,
          userAddress: wallet.address
        };
        const claimResponse = await makeApiRequest(
          "post",
          FAUCET_USDT_URL,
          payload,
          proxyUrl,
          { "Content-Type": "application/json" },
          3,
          2000,
          true
        );
        if (claimResponse.status === 200) {
          addLog(`Account ${accountIndex + 1}: USDT faucet claimed successfully. TxHash: ${getShortHash(claimResponse.data.txHash)}`, "success");
        } else if (claimResponse.status === 400 && claimResponse.message.includes("has already got token today")) {
          addLog(`Account ${accountIndex + 1}: Cannot claim USDT. Already claimed today.`, "warn");
        } else {
          addLog(`Account ${accountIndex + 1}: Failed to claim USDT: ${claimResponse.message}`, "error");
        }
      } catch (error) {
        addLog(`Account ${accountIndex + 1}: USDT faucet claim error: ${error.message}`, "error");
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 5 seconds before next account...`, "wait");
        await sleep(5000);
      }
    }
    addLog("Auto Claim USDT completed for all accounts.", "success");
  } catch (error) {
    addLog(`Auto Claim USDT failed: ${error.message}`, "error");
  } finally {
    await updateWallets(); 
  }
}

async function executeSwap(wallet, provider, swapCount, fromToken, toToken, amount, direction, accountIndex, proxyUrl) {
  if (shouldStop) {
    addLog("Swap stopped due to stop request.", "info");
    return false;
  }
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const contract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
    const pair = { from: fromToken === WPHRS_ADDRESS ? "WPHRS" : "USDT", to: toToken === WPHRS_ADDRESS ? "WPHRS" : "USDT" };
    const multicallData = await getMulticallData(pair, amount, signer.address);
    if (!multicallData.length) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Invalid multicall data`, "error");
      return false;
    }
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Executing Swap ${direction}...`, "info");
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const gasLimit = 300000;
    const tx = await contract.multicall(
      ethers.toBigInt(Math.floor(Date.now() / 1000)),
      multicallData,
      {
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
        nonce
      }
    );
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Transaction sent. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Transaction Confirmed. Swap completed`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Failed: ${error.message}`, "error");
    return false;
  }
}

async function runDailyActivity() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog(`Starting daily activity for all accounts. Auto Swap: ${dailyActivityConfig.swapRepetitions}, Auto Send PHRS: ${dailyActivityConfig.sendPhrsRepetitions}`, "info");
  activityRunning = true;
  isCycleRunning = true;
  shouldStop = false;
  hasLoggedSleepInterrupt = false;
  activeProcesses = Math.max(0, activeProcesses); 
  addLog(`Initial activeProcesses: ${activeProcesses}`, "debug");
  updateMenu();
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; account 🙂
