import React from 'react'
import { AppBar, Button, Container, makeStyles, Toolbar } from '@material-ui/core'
import { Link as RouterLink, useLocation } from 'react-router-dom'

const useStyles = makeStyles(theme => {
  return {
    logo: {
      height: theme.typography.h2.fontSize,
      margin: theme.spacing(1, 2, 2, 0)
    },
    contentContainer: {
      marginTop: theme.spacing(2),
    },
    nav: {
      display: 'flex',
      gap: theme.spacing(1),
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    navButton: {
      border: '1px solid rgba(255, 255, 255, 0.22)',
      borderRadius: 4,
      color: '#fff',
      minHeight: 34,
      padding: theme.spacing(0.75, 1.75),
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
      },
    },
    activeNavButton: {
      backgroundColor: 'rgba(255, 255, 255, 0.18)',
      borderColor: 'rgba(255, 255, 255, 0.55)',
      boxShadow: 'inset 0 -3px 0 rgba(255, 255, 255, 0.72)',
    },
  }
})

type LayoutProps = {
  testId: string // this makes it easy in cypress to determine on which page we are
  children?: React.ReactNode
}

const Layout = ({testId: cypressId, children}: LayoutProps) => {
  const classes = useStyles()
  const location = useLocation()
  const isActive = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  return (<div data-testid={`page-${cypressId}`}>
    <AppBar position="static">
      <Toolbar>
        <img width="106" height="40" className={classes.logo} src="/logo-with-text.svg" alt="vTally" />
        <div className={classes.nav}>
          <Button className={`${classes.navButton} ${isActive('/') ? classes.activeNavButton : ''}`} component={RouterLink} to="/">Tallies</Button>
          <Button className={`${classes.navButton} ${isActive('/config') ? classes.activeNavButton : ''}`} component={RouterLink} to="/config">Configuration</Button>
          <Button className={`${classes.navButton} ${isActive('/firmware') ? classes.activeNavButton : ''}`} component={RouterLink} to="/firmware">Firmware</Button>
        </div>
      </Toolbar>
    </AppBar>
    { children && (<Container maxWidth={false} className={classes.contentContainer} children={children} />) }
  </div>)
}

export default Layout;
