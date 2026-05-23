import React from 'react'
import ChannelSelector from '../components/ChannelSelector'
import { Tally as TallyType } from '../domain/Tally'
import useChannels from '../hooks/useChannels'
import useProgramPreview from '../hooks/useProgramPreview'
import { socket } from '../hooks/useSocket'
import { Button, IconButton, NativeSelect, Paper, Tooltip } from '@material-ui/core'
import { makeStyles } from '@material-ui/core'
import TallyMenu from './TallyMenu'
import DeleteIcon from '@material-ui/icons/Delete'


const useStyles = makeStyles(theme => {
    return {
        tally: {
            border: "solid 1px " + theme.palette.grey[800],
            width: "330px",
            maxWidth: "calc(100vw - 24px)",
            margin: theme.spacing(1),
            backgroundColor: theme.palette.grey[700],
            overflow: "hidden",
        },
        borderInPreview: {
            borderColor: theme.palette.success.main,
        },
        borderInProgram: {
            borderColor: theme.palette.error.main,
        },
        borderUnpatched: {
            borderColor: theme.palette.grey[500],
        },
        bgInPreview: {
            backgroundColor: theme.palette.success.main,
        },
        bgInProgram: {
            backgroundColor: theme.palette.error.main,
        },
        bgUnpatched: {
            backgroundColor: theme.palette.grey[500],
        },
        tallyHead: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: theme.spacing(1, 1, 1, 2),
            borderBottom: "1px solid " + theme.palette.grey[800],
        },
        tallyHeadTitle:  {

        },
        tallyHeadIcon: {

        },
        tallyBody: {
            padding: theme.spacing(2)
        },
        conditionRow: {
            display: "flex",
            alignItems: "center",
            gap: theme.spacing(1),
            marginBottom: theme.spacing(1),
            width: "100%",
        },
        conditionSelect: {
            flexGrow: 1,
            minWidth: 0,
            width: "100%",
            overflow: "hidden",
        },
        removeButtonWrap: {
            flex: "0 0 36px",
            width: "36px",
            display: "flex",
            justifyContent: "center",
        },
        matchMode: {
            marginBottom: theme.spacing(1),
            width: "100%",
        },
        matchModeSelect: {
            minHeight: "42px",
            paddingTop: `${theme.spacing(1.25)}px !important`,
            paddingBottom: `${theme.spacing(1.25)}px !important`,
            paddingLeft: `${theme.spacing(1.5)}px !important`,
            paddingRight: theme.spacing(4),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: "22px",
        },
        addSource: {
            width: "100%",
        },
        tallyFoot: {
            padding: theme.spacing(1, 2),
            borderTop: "1px solid " + theme.palette.grey[800],
            fontSize: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            textTransform: "uppercase",
            fontWeight: "bold",
        },
        tallyFootMissing: {
            backgroundColor: theme.palette.warning.main,
            color: theme.palette.getContrastText(theme.palette.warning.main)
        },
        tallyFootItem: {
            textAlign: "center",
            flexGrow: 1,
        },
    }
})

type TallyProps = {
    tally: TallyType
    className?: string
}

function Tally({ tally, className }: TallyProps) {
    const channels = useChannels()
    const [programs, previews] = useProgramPreview()
    const classes = useStyles()

    const patchTally = function (tally, channelIds, channelMatchMode = tally.channelMatchMode) {
        socket.emit('tally.patch.channels', tally.name, tally.type, channelIds, channelMatchMode)
    }
    const patchChannelIds = tally.getPatchChannelIds()
    const selectableChannels = channels || []
    const selectedChannelSet = new Set(patchChannelIds)
    const selectableAddChannels = selectableChannels.filter(channel => !selectedChannelSet.has(channel.id))
    const addChannel = () => {
        const nextChannel = selectableAddChannels[0]
        if (nextChannel) {
            patchTally(tally, [...patchChannelIds, nextChannel.id])
        }
    }
    const updateChannel = (index: number, value: string|null) => {
        const nextChannelIds = [...patchChannelIds]
        if (value) {
            nextChannelIds[index] = value
        } else {
            nextChannelIds.splice(index, 1)
        }
        patchTally(tally, nextChannelIds)
    }
    const removeChannel = (index: number) => {
        patchTally(tally, patchChannelIds.filter((_, idx) => idx !== index))
    }

    const classRoot: string[] = []
    className && classRoot.push(className)
    classRoot.push(classes.tally)
    const classHead = [classes.tallyHead]
    let dataColor = "idle"
    let isActive = false
    if (!tally.isPatched()) {
        classRoot.push(classes.borderUnpatched)
        dataColor = "unpatched"
    } else if (programs && tally.isIn(programs)) {
        classRoot.push(classes.borderInProgram)
        dataColor = "program"
    } else if (previews && tally.isIn(previews)) {
        classRoot.push(classes.borderInPreview)
        dataColor = "preview"
    }
    if (tally.isActive()) {
        isActive = true
        if (!tally.isPatched()) {
            classHead.push(classes.bgUnpatched)
        } else if (programs && tally.isIn(programs)) {
            classHead.push(classes.bgInProgram)
        } else if (previews && tally.isIn(previews)) {
            classHead.push(classes.bgInPreview)
        }
    }

    return (<>
        <Paper data-color={dataColor} data-isactive={isActive} className={classRoot.join(" ")} data-testid={`tally-${tally.name}`}>
            <div className={classHead.join(" ")}><>
                <div className={classes.tallyHeadTitle}>{tally.name}</div>
                <TallyMenu className={classes.tallyHeadIcon} tally={tally} />
            </></div>
            <div className={classes.tallyBody}>
                {patchChannelIds.length > 1 && (
                    <NativeSelect
                        className={classes.matchMode}
                        classes={{select: classes.matchModeSelect}}
                        value={tally.channelMatchMode}
                        onChange={event => patchTally(tally, patchChannelIds, event.target.value === "and" ? "and" : "or")}
                    >
                        <option value="or">OR - Any source</option>
                        <option value="and">AND - All sources</option>
                    </NativeSelect>
                )}
                {(patchChannelIds.length > 0 ? patchChannelIds : [undefined]).map((channelId, index) => (
                    <div className={classes.conditionRow} key={`${channelId || "unpatched"}-${index}`}>
                        <div className={classes.conditionSelect}>
                            <ChannelSelector value={channelId} channels={channels} onChange={value => updateChannel(index, value)} />
                        </div>
                        {patchChannelIds.length > 1 && (
                            <Tooltip title="Remove source"><span className={classes.removeButtonWrap}>
                                <IconButton size="small" onClick={() => removeChannel(index)}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </span></Tooltip>
                        )}
                    </div>
                ))}
                <Button
                    className={classes.addSource}
                    size="small"
                    variant="outlined"
                    disabled={selectableAddChannels.length === 0}
                    onClick={addChannel}
                >
                    Add Source
                </Button>
            </div>
            <div className={classes.tallyFoot + (tally.isActive() && tally.isMissing() ? " " + classes.tallyFootMissing : "")}>
                <div className={classes.tallyFootItem}>{ tally.isActive() ? (tally.isMissing() ? "missing": "connected") : "disconnected" }</div>
                {tally.isUdpTally() && tally.address && tally.port && (<div className={classes.tallyFootItem}>{tally.address}:{tally.port}</div>)}
            </div>
        </Paper>
    </>)
}


export default Tally;
