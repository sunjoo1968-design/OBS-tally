export type ChannelSaveObject = {
    id: string
    name?: string
    category?: ChannelCategory
}

export type ChannelCategory = "scene" | "group" | "source"

class Channel {
    id: string
    name?: string
    category?: ChannelCategory

    constructor(id: string, name?: string, category?: ChannelCategory) {
        this.id = id.toString()
        this.name = name
        this.category = category
    }

    toJson(): ChannelSaveObject {
        return {
            id: this.id,
            name: this.name,
            category: this.category,
        }
    }
    toString() {
        return this.name || this.id
    }

    static fromJson = function(valueObject: ChannelSaveObject) {
        const channel = new Channel(
            valueObject.id,
            valueObject.name,
            valueObject.category,
        )
        return channel
    }
}

export default Channel
