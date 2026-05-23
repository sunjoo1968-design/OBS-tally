import { makeStyles, Select } from "@material-ui/core";
import React from "react";
import Channel from '../domain/Channel'

const useStyles = makeStyles(theme => ({
    root: {
        display: "block",
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden",
    },
    select: {
        minHeight: "42px",
        paddingTop: `${theme.spacing(1.25)}px !important`,
        paddingBottom: `${theme.spacing(1.25)}px !important`,
        paddingLeft: `${theme.spacing(1.5)}px !important`,
        paddingRight: `${theme.spacing(4)}px !important`,
        maxWidth: "100%",
        boxSizing: "border-box",
        overflow: "visible",
        textOverflow: "clip",
        whiteSpace: "nowrap",
        lineHeight: "22px",
    },
}))

const groupLabels = {
    scene: "Scenes",
    group: "Groups",
    source: "Sources",
    other: "Other",
}

const groupOrder = ["scene", "group", "source", "other"]

type ChannelSelectorProps = {
    channels?: Channel[]
    value?: string
    onChange?: (value: string|null) => void
}

const ChannelSelector = ({channels, value = null, onChange} : ChannelSelectorProps) => {
    channels = channels || []
    const classes = useStyles()

    const handleValueChange = (e) => {
        let val = e.target.value.toString()
        if (val === "") { val = null }

        if (onChange) {
            onChange(val)
        }
    }

    let optionFound = value === null
    const groupedChannels = groupOrder.map(group => ({
        group,
        channels: channels.filter(c => (c.category || "other") === group)
    })).filter(({channels}) => channels.length > 0)

    const renderOption = (c: Channel) => {
        if (c.id === value) {
            optionFound = true
        }
        return <option key={c.id} value={c.id}>{c.name || `Channel ${c.id}`}</option>
    }

    return (<Select data-testid="channel-selector" native autoWidth={true} className={classes.root} classes={{ select: classes.select }} value={value || ""} onChange={handleValueChange}>
        <option value="" key={null}>(unpatched)</option>
        {groupedChannels.map(({group, channels}) => (
            <optgroup key={group} label={groupLabels[group]}>
                {channels.map(renderOption)}
            </optgroup>
        ))}
        { !optionFound && value !== undefined ? (<option key={value} value={value}>Channel {value}</option>) : "" }
    </Select>)
}

export default ChannelSelector;
