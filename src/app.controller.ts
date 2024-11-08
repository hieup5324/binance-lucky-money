import { Controller, Get, Param } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('messages/:channel')
  async getMessages(@Param('channel') channel: string) {
    return await this.appService.getMessagesFromChannel(channel);
  }
}
