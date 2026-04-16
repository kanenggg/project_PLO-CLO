*** Settings ***
Documentation     A resource file with reusable keywords and variables.
...
...               The system specific keywords created here form our own
...               domain specific language. They utilize keywords provided
...               by the imported SeleniumLibrary.
Library           SeleniumLibrary

*** Variables ***
${SERVER}         kanenggg.infinix-lab.com
${BROWSER}        headlesschrome
${DELAY}          0
${VALID USER}     admin@gmail.com
${VALID PASSWORD}    admin123
${LOGIN URL}      http://${SERVER}/
${WELCOME URL}    http://${SERVER}/
${ERROR URL}      http://${SERVER}/

*** Keywords ***
Open Browser To Login Page
    Open Browser    ${LOGIN URL}    ${BROWSER}
    Maximize Browser Window
    Set Selenium Speed    ${DELAY}
    Login Page Should Be Open

Login Page Should Be Open
    Title Should Be    PLOCLO

Go To Login Page
    Go To    ${LOGIN URL}
    Login Page Should Be Open

Input Username
    [Arguments]    ${username}
    Input Text    xpath=//input[@placeholder="Enter email"]    ${username}

Input Password
    [Arguments]    ${password}
    Input Text    xpath=//input[@placeholder="Enter password"]    ${password}

Submit Credentials
    Click Button    Sign In

Welcome Page Should Be Open
    Location Should Be    ${WELCOME URL}
    Title Should Be    PLOCLO