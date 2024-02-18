import { Buffer } from 'buffer';
import { ControlMessage, ControlMessageInterface } from './ControlMessage';

export interface TextControlMessageInterface extends ControlMessageInterface {
    text: string;
}

export class TextControlMessage extends ControlMessage {
    private static TEXT_SIZE_FIELD_LENGTH = 4;
    constructor(readonly text: string) {
        super(ControlMessage.TYPE_TEXT);
    }

    public getText(): string {
        return this.text;
    }

    /**
     * @override
     */
    public toBuffer(): Buffer {
        const length = Buffer.byteLength(this.text, 'utf-8');
        const buffer = Buffer.alloc(length + 1 + TextControlMessage.TEXT_SIZE_FIELD_LENGTH);
        let offset = 0;
        offset = buffer.writeUInt8(this.type, offset);
        console.log('offset 1', offset);
        offset = buffer.writeUInt32BE(length, offset);
        console.log('offset 2', offset);
        offset = buffer.write(this.text, offset);
        console.log('offset 3', offset, length, buffer.length);
        return buffer;
    }

    public toString(): string {
        return `TextControlMessage{text=${this.text}}`;
    }

    public toJSON(): TextControlMessageInterface {
        return {
            type: this.type,
            text: this.text,
        };
    }
}
