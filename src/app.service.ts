import { Injectable, OnModuleInit } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as fs from 'fs';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import Binance from 'binance-api-node';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';

dotenv.config();

@Injectable()
export class AppService implements OnModuleInit {
  private client: TelegramClient;
  private apiId: number;
  private apiHash: string;
  private sessionFilePath: string;
  private binanceClient: any;
  private session: StringSession;
  private processedMessagesFilePath = './processedMessages.txt'; // Đường dẫn file lưu tin nhắn đã xử lý
  private processedMessages: string[] = []; // Mảng để lưu trữ tin nhắn đã xử lý

  constructor() {
    this.apiId = Number(process.env.apiId);
    this.apiHash = process.env.apiHash;
    this.sessionFilePath = './session.txt';
    this.session = fs.existsSync(this.sessionFilePath)
      ? new StringSession(fs.readFileSync(this.sessionFilePath, 'utf-8'))
      : new StringSession('');
  }

  async onModuleInit() {
    if (!this.apiId || !this.apiHash) {
      console.error('API ID hoặc API Hash không được cấu hình đúng');
      return;
    }

    // Khởi tạo client Binance
    this.binanceClient = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    });

    await this.initializeTelegramClient();
    this.loadProcessedMessages(); // Tải các tin nhắn đã xử lý từ file
  }

  private loadProcessedMessages() {
    if (fs.existsSync(this.processedMessagesFilePath)) {
      const data = fs.readFileSync(this.processedMessagesFilePath, 'utf-8');
      this.processedMessages = data.split('\n').filter(Boolean); // Tách từng dòng và loại bỏ dòng rỗng
    }
  }

  private saveProcessedMessage(message: string) {
    fs.appendFileSync(this.processedMessagesFilePath, message + '\n');
  }

  @Cron('*/5 * * * * *')
  async handleCron() {
    const channelUsername = 'binance_box_channel';
    await this.getMessagesFromChannel(channelUsername);
  }

  private async initializeTelegramClient() {
    this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
      connectionRetries: 5,
    });

    try {
      if (this.session.authKey) {
        await this.client.connect();
        console.log('Session loaded. You are connected!');
      } else {
        await this.client.start({
          phoneNumber: async () =>
            await this.getInput('Please enter your number: '),
          password: async () =>
            await this.getInput('Please enter your password (if any): '),
          phoneCode: async () =>
            await this.getInput('Please enter the code you received: '),
          onError: (err) => console.log(err),
        });

        this.saveSession();
      }
    } catch (error) {
      console.error('Error initializing Telegram client:', error);
    }
  }

  private saveSession() {
    const sessionData = this.client.session.save();
    if (typeof sessionData === 'string') {
      fs.writeFileSync(this.sessionFilePath, sessionData);
      console.log('Session saved. You are now connected!');
    } else {
      console.error(
        'Failed to save session. The session data is invalid or empty.',
      );
    }
  }

  async getMessagesFromChannel(channelUsername: string) {
    if (!this.client) {
      throw new Error('Telegram client is not initialized');
    }

    try {
      const result = await this.client.getMessages(channelUsername, {
        limit: 2,
      });
      await Promise.all(
        result.map(async (item) => {
          const regex = /^[^\w]*(\w+)$/;
          const match = item.message.match(regex);
          console.log(match[1]);
          if (!this.processedMessages.includes(match[1])) {
            const response = await this.lixiBinance(match[1]);

            if (
              response.success ||
              response.message === 'Bao lì xì này đã được nhận rồi' ||
              response.message === 'Bao lì xì này đã được nhận hết'
            ) {
              this.processedMessages.push(match[1]);
              this.saveProcessedMessage(match[1]);
            }
          } else {
            console.log('Message already processed:', match[1]);
          }

          return item.message;
        }),
      );
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  }

  async lixiBinance(message: string) {
    const response = await axios.post(
      'https://www.binance.com/bapi/pay/v1/private/binance-pay/gift-box/code/grabV2',
      {
        grabCode: message,
        channel: 'DEFAULT',
        scene: null,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          Cookie: process.env.BINANCE_COOKIE,
          ' bnc-location': 'BINANCE',
          clienttype: 'web',
          csrftoken: process.env.BINANCE_CSRF_TOKEN,
        },
      },
    );
    console.log('Lixi Binance response:', response.data);
    return response.data;
  }

  async tradeFutures(message: string) {
    const tradeRegex = /#(\w+)\s+#(\w+)\s+#entry\s+(\d+(\.\d+)?)/; // Khớp với buy/sell với #entry

    const stopLossRegex =
      /#stop_loss\s+#(\w+)\s+#price\s+(\d+(\.\d+)?)\s+#pnl\s+(-?\d+(\.\d+)?%?)/; // Để khớp với stop loss

    const takeProfitRegex =
      /#take_profit\s+#(\w+)\s+#price\s+(\d+(\.\d+)?)\s+#pnl\s+(-?\d+(\.\d+)?%?)/; // Để khớp với take profit

    let matches;

    if ((matches = message.match(tradeRegex))) {
      const action = matches[1]; // buy/sell
      const symbol = matches[2]; // ZRXUSDT
      const entryPrice = parseFloat(matches[3]); // Giá vào
      const quantity = 1; // Số lượng có thể thay đổi theo nhu cầu
      console.log(action, symbol, entryPrice, quantity);

      await this.openFuturesPosition(action, symbol, quantity);
    } else if ((matches = message.match(stopLossRegex))) {
      const symbol = matches[1];
      const stopLossPrice = parseFloat(matches[2]);
      const quantity = 1;

      await this.placeStopLoss(symbol, stopLossPrice, quantity);
    } else if ((matches = message.match(takeProfitRegex))) {
      const symbol = matches[1];
      const takeProfitPrice = parseFloat(matches[2]);
      const quantity = 1;

      await this.placeTakeProfit(symbol, takeProfitPrice, quantity);
    } else {
      console.log('Tin nhắn không hợp lệ hoặc không đúng định dạng.');
    }
  }

  private async openFuturesPosition(
    action: string,
    symbol: string,
    quantity: number,
  ) {
    try {
      const order = await this.binanceClient.futuresOrder({
        symbol,
        side: action.toUpperCase(), // Chuyển đổi action thành chữ hoa
        type: 'MARKET',
        quantity,
      });
      console.log(
        `${action.charAt(0).toUpperCase() + action.slice(1)} order placed:`,
        order,
      );
    } catch (error) {
      console.error('Error placing order:', error);
    }
  }

  private async placeTakeProfit(
    symbol: string,
    takeProfitPrice: number,
    quantity: number,
  ) {
    try {
      const order = await this.binanceClient.futuresOrder({
        symbol,
        side: 'SELL',
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: takeProfitPrice,
        quantity,
      });
      console.log('Take profit order placed:', order);
    } catch (error) {
      console.error('Error placing take profit order:', error);
    }
  }

  private async placeStopLoss(
    symbol: string,
    stopLossPrice: number,
    quantity: number,
  ) {
    try {
      const order = await this.binanceClient.futuresOrder({
        symbol,
        side: 'SELL',
        type: 'STOP_MARKET',
        stopPrice: stopLossPrice,
        quantity,
      });
      console.log('Stop loss order placed:', order);
    } catch (error) {
      console.error('Error placing stop loss order:', error);
    }
  }

  private getInput(prompt: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(prompt, (input) => {
        rl.close();
        resolve(input);
      });
    });
  }
}
